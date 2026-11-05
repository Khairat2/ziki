import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ membership: vi.fn(), project: vi.fn(), agent: vi.fn(), key: vi.fn(), count: vi.fn(), createKey: vi.fn(), insert: vi.fn(), audit: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.lock, membership: { findFirst: m.membership }, project: { findFirst: m.project }, agent: { findFirst: m.agent, count: m.count }, agentApiKey: { findFirst: m.key, create: m.createKey } }) } }));
vi.mock("@/lib/agents/registry", () => ({ insertAgentWithKey: m.insert }));
vi.mock("@/lib/agents/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/secret-box", () => ({ openSecret: (s: string) => s.replace("sealed:", ""), sealSecret: (s: string) => `sealed:${s}` }));
import { connectPluginProject } from "./plugin-connection";
beforeEach(() => { vi.resetAllMocks(); m.membership.mockResolvedValue({ role: "member" }); m.project.mockResolvedValue({ id: "p" }); m.count.mockResolvedValue(0); m.insert.mockResolvedValue({ agentId: "a", rawKey: "secret", level: "working" }); });
it("requires actual membership and an active project", async () => {
  m.membership.mockResolvedValue(null);
  await expect(connectPluginProject("u", "t", "p")).rejects.toThrow(/membership/);
  expect(m.insert).not.toHaveBeenCalled(); expect(m.createKey).not.toHaveBeenCalled();
  m.membership.mockResolvedValue({}); m.project.mockResolvedValue(null);
  await expect(connectPluginProject("u", "t", "p")).rejects.toThrow(/membership/);
});
it("creates only a working agent with tenant, owner and project scope and audit", async () => {
  await connectPluginProject("u", "t", "p");
  expect(m.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: "t", ownerUserId: "u", projectId: "p", level: "working" }));
  expect(m.audit).toHaveBeenCalled(); expect(m.lock).toHaveBeenCalled();
});
it("reuses identity and key without changing its level", async () => {
  m.agent.mockResolvedValue({ id: "a", level: "reviewer" }); m.key.mockResolvedValue({ sealedKey: "sealed:secret" });
  expect(await connectPluginProject("u", "t", "p")).toEqual({ agentId: "a", rawKey: "secret", level: "reviewer" });
  expect(m.insert).not.toHaveBeenCalled(); expect(m.createKey).not.toHaveBeenCalled();
});
it("adds a project key to the same workspace identity", async () => {
  m.agent.mockResolvedValue({ id: "a", level: "working" });
  const result = await connectPluginProject("u", "t", "p");
  expect(result.agentId).toBe("a"); expect(m.insert).not.toHaveBeenCalled();
  expect(m.createKey).toHaveBeenCalledWith({ data: expect.objectContaining({ agentId: "a", projectId: "p" }) });
});
it("does not bypass revoked keys, revoked identities or active agent limits", async () => {
  m.agent.mockResolvedValue({ id: "a" }); m.key.mockResolvedValueOnce(null).mockResolvedValueOnce({ revokedAt: new Date() });
  await expect(connectPluginProject("u", "t", "p")).rejects.toThrow(/revoked/);
  m.agent.mockResolvedValueOnce(null).mockResolvedValueOnce({ revokedAt: new Date() });
  await expect(connectPluginProject("u", "t", "p")).rejects.toThrow(/revoked/);
  m.agent.mockResolvedValue(null); m.count.mockResolvedValue(5);
  await expect(connectPluginProject("u", "t", "p")).rejects.toThrow(/active agents/);
  expect(m.insert).not.toHaveBeenCalled(); expect(m.createKey).not.toHaveBeenCalled();
});
