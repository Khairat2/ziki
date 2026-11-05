import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sealSecret, openSecret } from "@/lib/secret-box";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const challengeFor = (value: string) => createHash("sha256").update(value).digest("base64url");
export const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function storeGrant<T>(kind: string, grant: T, seconds: number) {
  const token = randomBytes(32).toString("base64url");
  await prisma.agentOAuthGrant.create({ data: { hash: digest(token), kind, sealed: sealSecret(JSON.stringify(grant)), expiresAt: new Date(Date.now() + seconds * 1000) } });
  return token;
}
export async function readGrant<T = unknown>(token: string, kind: string): Promise<T | null> {
  if (!token || token.length > 256) return null;
  const row = await prisma.agentOAuthGrant.findUnique({ where: { hash: digest(token) } });
  if (!row || row.kind !== kind || row.expiresAt.getTime() <= Date.now()) return null;
  try { return JSON.parse(openSecret(row.sealed)) as T; } catch { return null; }
}
// Atomic deletion makes authorization codes and refresh tokens single use across replicas.
export async function consumeGrant(token: string, kind: string) {
  return (await prisma.agentOAuthGrant.deleteMany({ where: { hash: digest(token), kind, expiresAt: { gt: new Date() } } })).count === 1;
}
