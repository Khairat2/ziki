CREATE TABLE "AgentOAuthGrant" (
  "hash" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "sealed" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AgentOAuthGrant_expiresAt_idx" ON "AgentOAuthGrant"("expiresAt");
