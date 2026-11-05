import { beforeEach, expect, it, vi } from "vitest";
type Row = { id: string; name: string; level: string; tenantId: string; ownerUserId: string; revokedAt?: Date };
const m = vi.hoisted(() => ({ rows: [] as Row[], keys: [] as { agentId: string; projectId: string; sealedKey: string; revokedAt?: Date }[], member: vi.fn(), project: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), key: vi.fn(), createKey: vi.fn(), insert: vi.fn(), audit: vi.fn(), lock: vi.fn(), questions: vi.fn(), approvals: vi.fn(), transaction: vi.fn() }));
const tx = vi.hoisted(() => ({ $queryRaw: m.lock, membership: { findFirst: m.member }, project: { findFirst: m.project }, agent: { findMany: m.findMany, findFirst: m.findFirst, count: m.count, update: m.update }, agentApiKey: { findFirst: m.key, create: m.createKey }, agentQuestion: { findMany: m.questions }, issueApproval: { findMany: m.approvals } }));
vi.mock("@/lib/prisma", () => ({ prisma: { ...tx, $transaction: m.transaction } }));
vi.mock("@/lib/agents/registry", async original => ({ ...await original<typeof import("@/lib/agents/registry")>(), insertAgentWithKey: m.insert }));
vi.mock("@/lib/agents/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/secret-box", () => ({ openSecret: (s: string) => s.slice(7), sealSecret: (s: string) => `sealed:${s}` }));
import { ensurePluginAgents, listPluginAgents, pluginWorkspaceActivity, reconnectPluginAgent } from "./plugin-management";
beforeEach(() => {
  vi.resetAllMocks(); m.rows = []; m.keys = [];
  m.member.mockResolvedValue({ role: "member" }); m.project.mockResolvedValue({ id: "p" });
  m.transaction.mockImplementation(async fn => { const rows = structuredClone(m.rows), keys = structuredClone(m.keys); try { return await fn(tx); } catch (e) { m.rows = rows; m.keys = keys; throw e; } });
  m.findMany.mockImplementation(async ({ where }) => m.rows.filter(a => a.tenantId === where.tenantId && a.ownerUserId === where.ownerUserId && a.name.toLowerCase() === where.name.equals.toLowerCase()));
  m.findFirst.mockImplementation(async ({ where }) => m.rows.find(a => a.id === where.id && a.ownerUserId === where.ownerUserId && a.tenantId === where.tenantId && !a.revokedAt));
  m.count.mockImplementation(async ({ where }) => m.rows.filter(a => a.tenantId === where.tenantId && a.ownerUserId === where.ownerUserId && !a.revokedAt).length);
  m.key.mockImplementation(async ({ where }) => m.keys.find(k => k.agentId === where.agentId && k.projectId === where.projectId && (where.revokedAt === null ? !k.revokedAt : true)));
  m.createKey.mockImplementation(async ({ data }) => { m.keys.push(data); return data; });
  m.update.mockImplementation(async ({ where, data }) => Object.assign(m.rows.find(a => a.id === where.id)!, data));
  m.insert.mockImplementation(async (_db, data) => { const id = `a${m.rows.length}`; m.rows.push({ id, ...data }); m.keys.push({ agentId: id, projectId: data.projectId, sealedKey: `sealed:key-${id}` }); return { agentId: id, rawKey: `key-${id}`, level: data.level }; });
});
const requested = [{ name: "Ummi Working Agent", role: "working" }, { name: "Ummi Review Agent", role: "reviewing" }];
it("creates requested working/reviewing identities and reuses names and keys on a new call", async () => {
  const first = await ensurePluginAgents("u", "t", "p", requested);
  expect(first.map(a => a.level)).toEqual(["working", "working"]);
  const again = await ensurePluginAgents("u", "t", "p", [{ name: " ummi   working agent ", role: "working" }, requested[1]]);
  expect(again.map(a => a.agentId)).toEqual(first.map(a => a.agentId));
  expect(again.map(a => a.rawKey)).toEqual(first.map(a => a.rawKey));
  expect(m.insert).toHaveBeenCalledTimes(2); expect(m.createKey).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("isolates names by workspace and checks membership/project before creating", async () => {
  await ensurePluginAgents("u", "t", "p", requested);
  await ensurePluginAgents("u", "other", "other-project", requested);
  expect(m.rows).toHaveLength(4);
  m.member.mockResolvedValue(null);
  await expect(ensurePluginAgents("u", "forbidden", "p", requested)).rejects.toThrow(/membership/);
  await expect(reconnectPluginAgent("u", "forbidden", "p", "a0")).rejects.toThrow(/membership/);
});
it("rejects unsupported elevated roles, duplicate normalized names and revoked identities", async () => {
  await expect(ensurePluginAgents("u", "t", "p", [{ name: "Merger", role: "merger" }])).rejects.toThrow();
  await expect(ensurePluginAgents("u", "t", "p", [{ name: "Same name", role: "working" }, { name: " same   name ", role: "reviewing" }])).rejects.toThrow(/distinct/);
  m.rows.push({ id: "revoked", name: requested[0].name, tenantId: "t", ownerUserId: "u", level: "working", revokedAt: new Date() });
  await expect(ensurePluginAgents("u", "t", "p", requested)).rejects.toThrow(/revoked/);
  expect(m.insert).not.toHaveBeenCalled();
});
it("rolls back the entire batch at the existing per-workspace limit", async () => {
  for (let i = 0; i < 4; i++) m.rows.push({ id: `old${i}`, name: `Existing ${i}`, tenantId: "t", ownerUserId: "u", level: "observer" });
  await expect(ensurePluginAgents("u", "t", "p", requested)).rejects.toThrow(/active agents/);
  expect(m.rows).toHaveLength(4); expect(m.keys).toHaveLength(0);
});
it("reconnects only owned identities and never replaces a revoked project key", async () => {
  const [a] = await ensurePluginAgents("u", "t", "p", [requested[0]]);
  expect((await reconnectPluginAgent("u", "t", "p", a.agentId)).rawKey).toBe(a.rawKey);
  await expect(reconnectPluginAgent("someone-else", "t", "p", a.agentId)).rejects.toThrow(/not owned/);
  m.keys[0].revokedAt = new Date();
  await expect(reconnectPluginAgent("u", "t", "p", a.agentId)).rejects.toThrow(/revoked/);
  expect(m.createKey).not.toHaveBeenCalled();
});
it("preserves administrator-assigned class when reusing an identity", async () => {
 const [a] = await ensurePluginAgents("u", "t", "p", [requested[0]]);
 m.rows[0].level = "manager";
 const [reused] = await ensurePluginAgents("u", "t", "p", [{ name: a.name, role: "reviewing" }]);
 expect(reused.level).toBe("manager"); expect(m.update).not.toHaveBeenCalled();
});
it("discovers identities from server memberships without selecting secret fields", async () => {
  m.findMany.mockResolvedValue([]); await listPluginAgents("u");
  const query = m.findMany.mock.calls[0][0]; expect(query.where).toMatchObject({ ownerUserId: "u", tenant: { memberships: { some: { userId: "u" } } } });
  expect(JSON.stringify(query.select)).not.toMatch(/sealedKey|keyHash|rawKey/);
});
it("reads current pending activity, scopes owner questions and rejects former members", async () => {
  m.questions.mockResolvedValue([]); m.approvals.mockResolvedValue([]);
  const activity = await pluginWorkspaceActivity("u", "t"); expect(activity.approvals).toEqual([]);
  expect(m.questions).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: "u", answeredAt: null, agent: { tenantId: "t", revokedAt: null } } }));
  m.member.mockResolvedValue(null); await expect(pluginWorkspaceActivity("u", "t")).rejects.toThrow(/membership/);
});
