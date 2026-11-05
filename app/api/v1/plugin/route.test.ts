import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), read: vi.fn(), consume: vi.fn(), store: vi.fn(), findUser: vi.fn(), memberships: vi.fn(), connect: vi.fn(), budget: vi.fn(), agents: vi.fn(), ensure: vi.fn(), reconnect: vi.fn(), activity: vi.fn() }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: m.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: m.findUser, findUniqueOrThrow: m.findUser }, membership: { findMany: m.memberships } } }));
vi.mock("@/lib/agents/plugin-connection", () => ({ connectPluginProject: m.connect }));
vi.mock("@/lib/agents/plugin-management", () => ({ listPluginAgents: m.agents, ensurePluginAgents: m.ensure, reconnectPluginAgent: m.reconnect, pluginWorkspaceActivity: m.activity }));
vi.mock("@/lib/agents/plugin-grants", async original => ({ ...await original<typeof import("@/lib/agents/plugin-grants")>(), readGrant: m.read, consumeGrant: m.consume, storeGrant: m.store }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => "https://ziki.dev" }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: m.budget, clientIpFrom: () => "127.0.0.1" }));
import { challengeFor } from "@/lib/agents/plugin-grants";
import { GET, POST } from "./route";
import { PluginConnectionError } from "@/lib/agents/plugin-error";
const redirect = "http://127.0.0.1:12345/callback";
const verifier = "v".repeat(43);
const grant = { userId: "u", sessionVersion: 1, challenge: challengeFor(verifier), redirect, state: "s".repeat(43) };
const post = (body: unknown, token = "account") => POST(new Request("https://ziki.dev/api/v1/plugin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "u" } }); m.user.mockResolvedValue({ id: "u" }); m.findUser.mockResolvedValue({ sessionVersion: 1 }); m.budget.mockResolvedValue({ allowed: true }); m.consume.mockResolvedValue(true); m.store.mockResolvedValue("opaque"); });
it("only accepts loopback redirect and PKCE and keeps consent behind login", async () => {
  const u = new URL("https://ziki.dev/api/v1/plugin"); u.search = new URLSearchParams({ redirect_uri: redirect, code_challenge: grant.challenge, state: grant.state }).toString();
  const response = await GET(new Request(u)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain("Authorize this computer");
  m.auth.mockResolvedValue(null); expect((await GET(new Request(u))).headers.get("location")).toContain("/login?callbackUrl=");
  u.searchParams.set("redirect_uri", "https://evil.test/callback"); expect((await GET(new Request(u))).status).toBe(400);
});
it("rejects CSRF and consent for another user", async () => {
  const form = () => new URLSearchParams({ action: "authorize", consent: "opaque" });
  expect((await POST(new Request("https://ziki.dev/api/v1/plugin", { method: "POST", body: form() }))).status).toBe(403);
  m.read.mockResolvedValue({ ...grant, userId: "other" });
  const req = () => new Request("https://ziki.dev/api/v1/plugin", { method: "POST", headers: { Origin: "https://ziki.dev", Cookie: "ziki_plugin_consent=opaque" }, body: form() });
  expect((await POST(req())).status).toBe(400); expect(m.consume).not.toHaveBeenCalled();
  m.read.mockResolvedValue(grant); const response = await POST(req()); expect(response.status).toBe(303); expect(response.headers.get("location")).toContain(`${redirect}?code=opaque&state=`);
});
it("exchanges a single-use PKCE code, rejects wrong verifier/redirect and replay", async () => {
  m.read.mockResolvedValue(grant);
  expect((await post({ action: "token", code: "code", verifier: "x".repeat(43), redirectUri: redirect })).status).toBe(401);
  expect(m.consume).not.toHaveBeenCalled();
  expect((await post({ action: "token", code: "code", verifier, redirectUri: "http://127.0.0.1:9/callback" })).status).toBe(401);
  expect(await (await post({ action: "token", code: "code", verifier, redirectUri: redirect })).json()).toEqual({ token: "opaque", expiresIn: 2592000, management: false });
  m.consume.mockResolvedValue(false); expect((await post({ action: "token", code: "code", verifier, redirectUri: redirect })).status).toBe(401);
});
it("requires explicit management consent before discovery, role changes or reconnecting", async () => {
  m.read.mockResolvedValue(grant);
  for (const action of ["agents", "ensure", "reconnect", "activity"]) expect((await post({ action, workspaceId: "t", projectId: "p", agentId: "a" })).status).toBe(403);
  expect(m.ensure).not.toHaveBeenCalled(); expect(m.reconnect).not.toHaveBeenCalled();
  m.read.mockResolvedValue({ ...grant, management: true }); m.agents.mockResolvedValue([{ id: "a", name: "Ummi" }]);
  expect(await (await post({ action: "agents" })).json()).toEqual({ agents: [{ id: "a", name: "Ummi" }] });
  m.ensure.mockResolvedValue([{ agentId: "a", level: "contributor" }]);
  expect((await post({ action: "ensure", workspaceId: "t", projectId: "p", agents: [{ name: "Ummi", role: "working" }] })).status).toBe(200);
  expect(m.ensure).toHaveBeenCalledWith("u", "t", "p", [{ name: "Ummi", role: "working" }]);
});
it("requires an account credential and invalidates it after session version changes", async () => {
  expect((await post({ action: "workspaces" })).status).toBe(401);
  m.read.mockResolvedValue({ userId: "u", sessionVersion: 0 }); expect((await post({ action: "select", workspaceId: "t", projectId: "p" })).status).toBe(401); expect(m.connect).not.toHaveBeenCalled();
});
it("lists only active memberships and delegates switch permission checks", async () => {
  m.read.mockResolvedValue(grant); m.memberships.mockResolvedValue([]);
  expect(await (await post({ action: "workspaces" })).json()).toEqual({ workspaces: [] });
  expect(m.memberships).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u", tenant: { archivedAt: null } } }));
  m.connect.mockRejectedValue(new PluginConnectionError("Workspace membership and an active project are required."));
  expect((await post({ action: "select", workspaceId: "foreign", projectId: "p" })).status).toBe(403);
});
it("never exposes database error details even when they mention membership", async () => {
  m.read.mockResolvedValue(grant); m.connect.mockRejectedValue(Error("membership query failed: private database details"));
  const response = await post({ action: "select", workspaceId: "t", projectId: "p" });
  expect(response.status).toBe(400); expect(await response.text()).not.toContain("private database");
});
it("supports revocation and enforces rate limits", async () => {
  m.read.mockResolvedValue(grant); expect((await post({ action: "logout" })).status).toBe(200); expect(m.consume).toHaveBeenCalledWith("account", "plugin-account");
  m.budget.mockResolvedValue({ allowed: false }); expect((await post({ action: "workspaces" })).status).toBe(429);
});
