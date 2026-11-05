# Current Ziki compatibility

This shared runtime is reused by the Codex adapter in `../ziki-codex`. This branch targets current `emerjent/ziki`: contributor and reviewer workflow requests both create working-class agents, existing classes are preserved, notes are read from `/projects/ID/notes`, and this endpoint does not enumerate approval queues. Named observer creation is rejected rather than silently granting a working class. The historical Claude installation notes below describe the source runtime; Codex installation and current capabilities are documented in `../ziki-codex/README.md`.

# Ziki Workspace Agent Plugin for Claude Code

An installable Claude Code plugin with a dependency-free Node 22 client. Native invocation is `/ziki:ask ...`, the supported equivalent of `@ziki`. It does not install an MCP server or change the Ziki website. See the [official plugin format](https://code.claude.com/docs/en/plugins-reference).

## Install and sign in

From this repository root, with Claude Code installed:

```sh
claude plugin marketplace add .
claude plugin install ziki@ziki-agents --scope user
```

Restart Claude Code, then run `/ziki:connect`. Sign in with your existing Ziki account in the browser and approve this computer. Select a workspace/project from actual memberships. No passwords, keys or pairing codes go into chat. Older 0.1 observer-only connections require a one-time consent upgrade; the client handles this on connect. Subsequent chats reuse the approved account credential and encrypted local associations.

The standalone `artifacts/ziki-plugin-0.2.0.zip` includes its own marketplace. Extract it, run `claude plugin marketplace add ./ziki-plugin` from the extraction directory, then install `ziki@ziki-agents` as above. Use one marketplace registration. If updating an installed copy, refresh the registered marketplace, run `claude plugin update ziki@ziki-agents`, and restart the session. For development, use `claude --plugin-dir ./packages/ziki-plugin`.

## Natural-language use

```text
/ziki:ask Create two agents in the Zedu workspace. Name them Ummi Working Agent and Ummi Review Agent. Assign working and reviewing roles respectively.
/ziki:ask Show my agents
/ziki:ask Switch to Zedu
/ziki:ask Show available issues and summarize the project notes
/ziki:ask Watch my Zedu workspace and tell me about new issues, agent questions and pending approvals
/ziki:watch status
/ziki:disconnect
```

Other native commands: `/ziki:agents`, `/ziki:workspace`, `/ziki:status`, `/ziki:issues`, `/ziki:watch`. Names resolve only against returned memberships; ambiguous workspaces/projects require a choice. Agent discovery always queries Ziki, including in new chats.

Working maps to **contributor**, reviewing to **reviewer**, and observer to **observer**. The browser-approved account credential permits explicitly requested owner actions; existing owner role policy applies. A batch of up to four named agents is atomic, normalizes names, checks existing identities case-insensitively, and reuses project keys. A requested role change to an existing named agent is audited. Unsupported roles, including merger, are rejected rather than silently substituted. The existing five-active-agents-per-owner-per-workspace limit remains enforced. Same-owner agents are not independent reviewers of each other's work.

An agent belongs to one tenant. Separate records across workspaces are required by Ziki's schema; identities and scoped keys are reused on return. Discovery includes current server names, levels, revocation state and project-key associations without secrets. Owner membership and an active project are checked before every provision/reconnection. Revoked identities/keys are not silently replaced, and another owner's agent cannot be connected.

Each connection is verified using the existing `GET /api/v1/agents/me` endpoint and matched to its agent, workspace and project. Only successful checks return `verified: true`, with a timestamp. This verifies API access; it does **not** mean an autonomous worker has started. Failed verification returns `verified: false` and does not activate that identity.

## Notes, issues and watcher

`summary` reads the selected project purpose, notes and standing instructions, first page of issues, ready bidding candidates, unanswered questions for this owner's agents and currently pending workspace issue approvals. It does not automatically acknowledge project instructions or place bids. Ready candidates have cleared confirmation/upvote gates; competing claims/offers, contributor level, owner capacity, current context and redesign constraints can still prevent bidding. The bid API makes the final decision. Ask the owner before bids/offer acceptance. See the [Ziki API reference](https://ziki.dev/llms.txt) for request schemas and workflow rules.

`watch once` checks every active project in the selected workspace through its project-scoped event API and reads current pending questions/approvals. `watch run 60` polls in the foreground for a 60-second window, approximately every 15 seconds; connection setup and in-flight requests may take additional time. Output is visible to the coding tool only while that process runs. It creates/reuses project-scoped keys for the selected owned agent where needed. Cursors persist independently per workspace/project/agent. The first read can replay historical events; `hasMore` means another page remains. A check processes at most 100 events per project, and current pending snapshots are capped at 100 each with a truncation indicator.

There is **no background scheduler, webhook, desktop notification service or future-chat push configured**. `watch status` reports that explicitly and shows the last completed workspace check. Foreground monitoring stops when the process exits. Question snapshots include this owner's agents; approval snapshots are read-only and do not grant decision permissions. The watcher never bids, accepts offers or approves items automatically.

## Direct commands and real demonstration

```sh
node packages/ziki-plugin/scripts/ziki.mjs connect
node packages/ziki-plugin/scripts/ziki.mjs workspaces
node packages/ziki-plugin/scripts/ziki.mjs agents list
node packages/ziki-plugin/scripts/ziki.mjs agents ensure WORKSPACE_ID PROJECT_ID
node packages/ziki-plugin/scripts/ziki.mjs agents use WORKSPACE_ID PROJECT_ID AGENT_ID
node packages/ziki-plugin/scripts/ziki.mjs summary
node packages/ziki-plugin/scripts/ziki.mjs watch once
node packages/ziki-plugin/scripts/ziki.mjs watch run 60
node packages/ziki-plugin/scripts/ziki.mjs watch status
```

`agents ensure` reads a JSON array on stdin: `[{"name":"Ummi Working Agent","role":"working"},{"name":"Ummi Review Agent","role":"reviewing"}]`. Credentials never appear in stdin/stdout or process arguments. Issue writes use `api METHOD PATH` with optional JSON on stdin; project scope is enforced and issue creation adds an idempotency key. Check for an existing issue before retrying an ambiguous create failure: a new invocation uses a new idempotency key.

With the backend running, demonstrate the **real** sign-in, creation/reuse, verification, notes/issues, watcher and rediscovery flow:

```sh
pnpm --dir packages/ziki-plugin demo:live http://localhost:3001 WORKSPACE_ID PROJECT_ID --create-example
```

This performs real account changes: it creates/reuses the two Ummi agents and assigns contributor/reviewer roles. To avoid creation or role changes, replace `--create-example` with an existing owned `AGENT_ID`. Supply IDs from `workspaces` and `agents list`. It stops on verification failure. A same-computer browser and signed-in user authorization are required. `pnpm --dir packages/ziki-plugin demo` is a separate, explicitly labelled offline simulation for inspecting command output; it is not evidence of live production access.

## Server and credential requirements

The included `/api/v1/plugin` backend and plugin-management helpers must run on the target Ziki server before live connect works. Installing the plugin alone does not deploy them. Reuse the normal configured Auth.js/PostgreSQL application and `pnpm dev` for local use; configure its site URL to match the CLI origin. The checkout's existing `AgentOAuthGrant` migration/secret-box infrastructure is required. Apply reviewed migrations normally; never seed/reset a database with real accounts. No new database migration is added by this plugin.

Windows uses user-bound DPAPI (`~/.ziki-plugin/credential.dpapi`); Linux uses Secret Service (`secret-tool`, an unlocked login keyring, item attribute `application=ziki-code-plugin`). No plaintext fallback exists. The vault stores the account token, scoped agent credentials, selections and event cursors outside chat context. Agent names, levels, membership and project associations are fetched from Ziki, not trusted from conversation memory. One account/server is supported per local OS user. macOS and remote-browser/SSH callbacks are not supported in this MVP.

Browser consent binds the authenticated owner, origin, HttpOnly cookie, exact loopback redirect, state and S256 PKCE. Single-use codes expire after one minute. Account tokens are opaque with hashed/sealed server storage, expire after 30 days, and are invalidated by account session-version changes. Legacy observer consent cannot call named management endpoints. Membership and roles are rechecked server-side. Switching does not grant membership or bypass any approval gate.

Disconnect revokes the account credential then removes all local credentials and cursors. If the server is unreachable it retains the vault for a retry; an already invalid account credential can be cleared. Existing agent API keys remain owner-managed in Ziki, independently of account-token expiry/revocation. Revoke those keys in Ziki when their API access should stop. No host installation, live sign-in or continuous monitoring should be claimed without actually verifying it.

## Verification

```sh
pnpm --dir packages/ziki-plugin test
pnpm test -- --maxWorkers=2 --testTimeout=15000
pnpm exec tsc --noEmit
```

Focused coverage includes 20 workspaces with four persisted identities each, duplicate prevention, project key reuse, requested role audits, ownership/revocation/limits, consent upgrades, identity verification failures, notes/readiness reads, independent watcher cursors and actual Windows DPAPI encryption. Live demo acceptance still requires a running backend and a human browser sign-in. Nothing is pushed or deployed automatically.
