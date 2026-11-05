import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { generateApiKey } from "@/lib/agents/keys";
import { insertAgentWithKey } from "@/lib/agents/registry";
import { MAX_ACTIVE_AGENTS_PER_OWNER, AGENT_LIMIT_MESSAGE } from "@/lib/agents/registry-limits";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { PluginConnectionError } from "@/lib/agents/plugin-error";

/** Tenant identities cannot cross workspaces. Project keys reuse one identity per tenant. */
export async function connectPluginProject(userId: string, tenantId: string, projectId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plugin:${tenantId}:${userId}`}, 0))::text`;
    const membership = await tx.membership.findFirst({ where: { userId, tenantId, tenant: { archivedAt: null } } });
    const project = membership && await tx.project.findFirst({ where: { id: projectId, tenantId, archivedAt: null } });
    if (!membership || !project) throw new PluginConnectionError("Workspace membership and an active project are required.");
    const agent = await tx.agent.findFirst({ where: { tenantId, ownerUserId: userId, model: "Ziki Codex plugin", revokedAt: null }, orderBy: { createdAt: "asc" } });
    if (agent) {
      const existing = await tx.agentApiKey.findFirst({ where: { agentId: agent.id, projectId, revokedAt: null }, orderBy: { createdAt: "desc" } });
      if (existing?.sealedKey) return { agentId: agent.id, rawKey: openSecret(existing.sealedKey), level: agent.level };
      // Never silently replace a revoked or legacy/unrecoverable key.
      if (await tx.agentApiKey.findFirst({ where: { agentId: agent.id, projectId } })) throw new PluginConnectionError("This project's key is revoked or unavailable. Manage it in Your agents before reconnecting.");
      const key = generateApiKey();
      await tx.agentApiKey.create({ data: { agentId: agent.id, projectId, keyHash: key.hash, prefix: key.prefix, sealedKey: sealSecret(key.raw) } });
      await audit({ agentId: agent.id, tenantId }, "agent.key_created", `project:${projectId}`, { via: "plugin" }, { actorUserId: userId, db: tx });
      return { agentId: agent.id, rawKey: key.raw, level: agent.level };
    }
    // A revoked plugin identity is an explicit owner/admin decision, not an invitation to recreate it.
    if (await tx.agent.findFirst({ where: { tenantId, ownerUserId: userId, model: "Ziki Codex plugin" } })) throw new PluginConnectionError("Plugin agent revoked. Ask your workspace administrator before reconnecting.");
    if (await tx.agent.count({ where: { tenantId, ownerUserId: userId, revokedAt: null } }) >= MAX_ACTIVE_AGENTS_PER_OWNER) throw new PluginConnectionError(AGENT_LIMIT_MESSAGE);
    const key = await insertAgentWithKey(tx, { tenantId, ownerUserId: userId, projectId, name: "My Ziki coding agent", model: "Ziki Codex plugin", level: "working" });
    await audit({ agentId: key.agentId, tenantId }, "agent.created", `agent:${key.agentId}`, { via: "plugin", projectId, level: "working" }, { actorUserId: userId, db: tx });
    return { agentId: key.agentId, rawKey: key.rawKey, level: key.level };
  });
}
