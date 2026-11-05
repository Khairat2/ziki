import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { challengeFor, consumeGrant, readGrant, storeGrant, privateHeaders } from "@/lib/agents/plugin-grants";
import { connectPluginProject } from "@/lib/agents/plugin-connection";
import { listPluginAgents, ensurePluginAgents, reconnectPluginAgent, pluginWorkspaceActivity } from "@/lib/agents/plugin-management";
import { PluginConnectionError } from "@/lib/agents/plugin-error";
import { getSiteUrl } from "@/lib/site-url";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { consumeRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";

type Consent = { userId: string; sessionVersion: number; challenge: string; redirect: string; state: string; management?: boolean };
type Account = { userId: string; sessionVersion: number; management?: boolean };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function validCallback(value: string) {
  try { const u = new URL(value); return u.protocol === "http:" && u.hostname === "127.0.0.1" && Boolean(u.port) && u.pathname === "/callback" && !u.search && !u.hash && !u.username && !u.password; } catch { return false; }
}

/** Browser-only consent. No keys or account credentials appear in this page or URL. */
export async function GET(request: Request) {
  if (!isAgentPlatformEnabled()) return json({ error: "Agent platform disabled" }, 503);
  const url = new URL(request.url), p = url.searchParams;
  if (!validCallback(p.get("redirect_uri") ?? "") || !/^[\w-]{43}$/.test(p.get("code_challenge") ?? "") || !/^[\w-]{32,128}$/.test(p.get("state") ?? "")) return json({ error: "Invalid authorization request" }, 400);
  if (!(await auth())?.user) return Response.redirect(`${getSiteUrl()}/login?callbackUrl=${encodeURIComponent(url.pathname + url.search)}`);
  const user = await requireUser();
  const budget = await consumeRateLimit(`plugin-consent:${user.id}`, { max: 10, windowMs: 60000 });
  if (!budget.allowed) return json({ error: "Too many requests" }, 429);
  const management = p.get("scope") === "agents";
  const consent = await storeGrant<Consent>("plugin-consent", { userId: user.id, sessionVersion: (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } })).sessionVersion, redirect: p.get("redirect_uri")!, challenge: p.get("code_challenge")!, state: p.get("state")!, management }, 600);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Authorize Ziki coding plugin</title><h1>Connect Ziki to Codex</h1><p>${management ? "Allow this plugin to discover your agents, connect them, create named agents and assign owner-permitted contributor/reviewer roles at your request, and read workspace activity. This applies to workspaces you belong to now or join later." : "Allow this plugin to list your workspaces and create or reuse your working agent."} Existing permissions and administrator decisions still apply. Authorization expires after 30 days. Signing out in the plugin revokes it.</p><form method="post" action="${escape(getSiteUrl())}/api/v1/plugin"><input type="hidden" name="action" value="authorize"><input type="hidden" name="consent" value="${escape(consent)}"><button>Authorize this computer</button></form></html>`, { headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "Set-Cookie": `ziki_plugin_consent=${consent}; HttpOnly; SameSite=Strict; Path=/api/v1/plugin; Max-Age=600${new URL(getSiteUrl()).protocol === "https:" ? "; Secure" : ""}` } });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);

export async function POST(request: Request) {
  if (!isAgentPlatformEnabled()) return json({ error: "Agent platform disabled" }, 503);
  const budget = await consumeRateLimit(`plugin:${clientIpFrom(request.headers)}`, { max: 60, windowMs: 60000 });
  if (!budget.allowed) return json({ error: "Too many requests" }, 429);
  try {
    if (request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
      if (request.headers.get("origin") !== new URL(getSiteUrl()).origin || !request.headers.get("cookie")?.includes("ziki_plugin_consent=")) return json({ error: "Invalid origin" }, 403);
      const form = await request.formData();
      const token = String(form.get("consent") ?? "");
      if (!request.headers.get("cookie")?.split(";").some(c => c.trim() === `ziki_plugin_consent=${token}`)) return json({ error: "Invalid consent cookie" }, 403);
      const grant = await readGrant<Consent>(token, "plugin-consent");
      const user = await requireUser();
      if (!grant || grant.userId !== user.id || !await consumeGrant(token, "plugin-consent")) return json({ error: "Consent expired" }, 400);
      const code = await storeGrant("plugin-code", grant, 60);
      const callback = new URL(grant.redirect); callback.searchParams.set("code", code); callback.searchParams.set("state", grant.state);
      return new Response(null, { status: 303, headers: { ...privateHeaders, Location: callback.toString() } });
    }
    const body = await request.json();
    if (body.action === "token") {
      const grant = await readGrant<Consent>(body.code, "plugin-code");
      if (!grant || typeof body.verifier !== "string" || !/^[\w-]{43,128}$/.test(body.verifier) || challengeFor(body.verifier) !== grant.challenge || body.redirectUri !== grant.redirect || !await consumeGrant(body.code, "plugin-code")) return json({ error: "Invalid code" }, 401);
      const token = await storeGrant<Account>("plugin-account", { userId: grant.userId, sessionVersion: grant.sessionVersion, management: grant.management === true }, 30 * 86400);
      return json({ token, expiresIn: 30 * 86400, management: grant.management === true });
    }
    const token = request.headers.get("authorization")?.match(/^Bearer ([\w-]+)$/)?.[1] ?? "";
    const account = await readGrant<Account>(token, "plugin-account");
    const user = account && await prisma.user.findUnique({ where: { id: account.userId }, select: { sessionVersion: true } });
    if (!account || !user || account.sessionVersion !== user.sessionVersion) return json({ error: "Reconnect the Ziki plugin" }, 401);
    if (body.action === "logout") { await consumeGrant(token, "plugin-account"); return json({ ok: true }); }
    if (["agents", "ensure", "reconnect", "activity"].includes(body.action)) {
      if (!account.management) return json({ error: "Agent management requires renewed browser consent. Run connect --manage." }, 403);
      if (body.action === "agents") return json({ agents: await listPluginAgents(account.userId) });
      if (typeof body.workspaceId !== "string" || body.workspaceId.length > 191) return json({ error: "Workspace ID required" }, 400);
      if (body.action === "activity") return json(await pluginWorkspaceActivity(account.userId, body.workspaceId));
      if (typeof body.projectId !== "string" || body.projectId.length > 191) return json({ error: "Project ID required" }, 400);
      if (body.action === "ensure") return json({ connections: await ensurePluginAgents(account.userId, body.workspaceId, body.projectId, body.agents) });
      if (typeof body.agentId === "string" && body.agentId.length <= 191) return json(await reconnectPluginAgent(account.userId, body.workspaceId, body.projectId, body.agentId));
      return json({ error: "Agent ID required" }, 400);
    }
    if (body.action === "workspaces") return json({ workspaces: await prisma.membership.findMany({ where: { userId: account.userId, tenant: { archivedAt: null } }, select: { role: true, tenant: { select: { id: true, name: true, slug: true, projects: { where: { archivedAt: null }, select: { id: true, name: true, slug: true } } } } }, orderBy: { createdAt: "asc" } }) });
    if (body.action === "select" && typeof body.workspaceId === "string" && typeof body.projectId === "string") return json(await connectPluginProject(account.userId, body.workspaceId, body.projectId));
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    // Authorization and membership failures must not return database details.
    if (error instanceof PluginConnectionError) return json({ error: error.message }, 403);
    return json({ error: "Plugin request failed" }, 400);
  }
}
