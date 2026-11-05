import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agentNameSchema, insertAgentWithKey } from "@/lib/agents/registry";

import { generateApiKey } from "@/lib/agents/keys";
import { audit } from "@/lib/agents/audit";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { MAX_ACTIVE_AGENTS_PER_OWNER, AGENT_LIMIT_MESSAGE } from "@/lib/agents/registry-limits";
import { PluginConnectionError } from "@/lib/agents/plugin-error";

// Workflow roles never grant manager or merger privileges. Both are working-class agents.
const roles = { working: "working", reviewing: "working" } as const;
export const pluginAgentsSchema = z.array(z.object({ name: agentNameSchema, role: z.enum(["working", "reviewing"]) }).strict()).min(1).max(4)
  .refine(items => new Set(items.map(i => i.name.toLowerCase())).size === items.length, "Agent names must be distinct.");

async function checkProject(tx: Prisma.TransactionClient, userId: string, tenantId: string, projectId: string) {
  const member = await tx.membership.findFirst({ where: { userId, tenantId, tenant: { archivedAt: null } } });
  const project = member && await tx.project.findFirst({ where: { id: projectId, tenantId, archivedAt: null } });
  if (!member || !project) throw new PluginConnectionError("Workspace membership and an active project are required.");
  return member;
}

async function projectKey(tx: Prisma.TransactionClient, userId: string, tenantId: string, agentId: string, projectId: string) {
  const key = await tx.agentApiKey.findFirst({ where: { agentId, projectId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  if (key?.sealedKey) return openSecret(key.sealedKey);
  if (await tx.agentApiKey.findFirst({ where: { agentId, projectId } })) throw new PluginConnectionError("Project key revoked or unavailable. Manage it in Ziki before reconnecting.");
  const issued = generateApiKey();
  await tx.agentApiKey.create({ data: { agentId, projectId, keyHash: issued.hash, prefix: issued.prefix, sealedKey: sealSecret(issued.raw) } });
  await audit({ agentId, tenantId }, "agent.key_created", `project:${projectId}`, { via: "plugin" }, { actorUserId: userId, db: tx });
  return issued.raw;
}

/** Query the server every time; no names, memberships or roles come from chat memory. */
export async function listPluginAgents(userId: string) {
  return prisma.agent.findMany({
    where: { ownerUserId: userId, tenant: { archivedAt: null, memberships: { some: { userId } } } },
    select: { id: true, name: true, level: true, model: true, revokedAt: true, tenantId: true,
      tenant: { select: { id: true, name: true, slug: true } },
      apiKeys: { select: { projectId: true, revokedAt: true } } },
    orderBy: [{ tenantId: "asc" }, { name: "asc" }],
  });
}

/** Batch is atomic: failure to provision either role rolls back both creations. */
export async function ensurePluginAgents(userId: string, tenantId: string, projectId: string, input: unknown) {
  const parsed = pluginAgentsSchema.safeParse(input);
  if (!parsed.success) throw new PluginConnectionError(parsed.error.issues[0]?.message ?? "Invalid agents.");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plugin:${tenantId}:${userId}`}, 0))::text`;
    await checkProject(tx, userId, tenantId, projectId);
    const connections = [];
    for (const item of parsed.data) {
      const level = roles[item.role];
      const matches = await tx.agent.findMany({ where: { tenantId, ownerUserId: userId, name: { equals: item.name, mode: "insensitive" } }, take: 2 });
      if (matches.length > 1) throw new PluginConnectionError("More than one agent has that name. Connect by agent ID instead.");
      const agent = matches[0];
      if (agent?.revokedAt) throw new PluginConnectionError("That named agent was revoked. Ask your administrator before reconnecting.");
      if (agent) {
        // Reuse an existing identity without changing its administrator-assigned class.
        const rawKey = await projectKey(tx, userId, tenantId, agent.id, projectId);
        connections.push({ agentId: agent.id, name: agent.name, level: agent.level, role: item.role, rawKey, reused: true });
      } else {
        if (await tx.agent.count({ where: { tenantId, ownerUserId: userId, revokedAt: null } }) >= MAX_ACTIVE_AGENTS_PER_OWNER) throw new PluginConnectionError(AGENT_LIMIT_MESSAGE);
        const issued = await insertAgentWithKey(tx, { tenantId, ownerUserId: userId, projectId, name: item.name, model: "Ziki workspace agent", level });
        await audit({ agentId: issued.agentId, tenantId }, "agent.created", `agent:${issued.agentId}`, { via: "plugin", projectId, name: item.name, level }, { actorUserId: userId, db: tx });
        connections.push({ agentId: issued.agentId, name: item.name, level, role: item.role, rawKey: issued.rawKey, reused: false });
      }
    }
    return connections;
  });
}

export async function reconnectPluginAgent(userId: string, tenantId: string, projectId: string, agentId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plugin:${tenantId}:${userId}`}, 0))::text`;
    await checkProject(tx, userId, tenantId, projectId);
    const agent = await tx.agent.findFirst({ where: { id: agentId, ownerUserId: userId, tenantId, revokedAt: null } });
    if (!agent) throw new PluginConnectionError("Agent not found, revoked, or not owned by you in this workspace.");
    return { agentId: agent.id, name: agent.name, level: agent.level, rawKey: await projectKey(tx, userId, tenantId, agent.id, projectId), reused: true };
  });
}

/** Current pending state, not an inference from historical requested events. */
export async function pluginWorkspaceActivity(userId: string, tenantId: string) {
  if (!await prisma.membership.findFirst({ where: { userId, tenantId, tenant: { archivedAt: null } } })) throw new PluginConnectionError("Workspace membership is required.");
  const questions = await prisma.agentQuestion.findMany({ where: { ownerUserId: userId, answeredAt: null, agent: { tenantId, revokedAt: null } }, select: { id: true, body: true, bugId: true, createdAt: true, agent: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" }, take: 100 });
  const approvals: never[] = [];
  return { questions, approvals, limit: 100, possiblyTruncated: questions.length === 100 || approvals.length === 100, questionScope: "your agents", approvalScope: "not provided by this endpoint; consult Ziki for approvals" };
}
