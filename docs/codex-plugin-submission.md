# Codex workspace agent plugin

This is a local Codex plugin and a simulated, public web demonstration, not a published OpenAI directory listing. The plugin package uses the documented `.codex-plugin/plugin.json` skill format. Build it using `pnpm --dir packages/ziki-codex build`. The generated marketplace catalog is for local testing only. Standalone installation remains available with `node packages/ziki-codex/install.mjs --user`; open a new Codex chat and invoke `$ziki`.

## Live demo

https://ziki-codex-workspace-demo.vercel.app

The demo implements + → Plugins → Ziki, installation, simulated Codexx authorization, Zedu/Ziki workspace selection, creation/retrieval of both Ummi agents, retained identity across chats/reloads, notes/issues/status fixtures, workspace activity, disconnection and reset. Only fictional metadata is saved in browser localStorage. The actual plugin uses OS-encrypted credentials; no credentials are stored by this demo.

## Production deployment prerequisite

Deploy the backend and apply `prisma migrate deploy` using your normal release process. Do not reseed or reset a database. The added consent grant table stores hashed tokens and encrypted payloads. Browser consent uses PKCE and an exact loopback callback, single-use codes, same-origin form and consent-cookie checks, account session version checks, 30-day revocable account sessions and rate limits. Membership, ownership, project scope, revocation and five-agent limits are enforced server-side. Agent batches are atomic and serialized per owner/workspace.

Contributor and reviewer describe workflow purposes. Both new agents have the current `working` class. Existing classes are retained; the plugin never grants `manager` or `merger`. Same-owner agents are not independent reviewers. API verification does not start workers. Activity polling is bounded foreground work and does not install a scheduler.

## Connect the existing Codexx account

After the plugin backend is deployed at the selected origin:

1. Run `node packages/ziki-codex/install.mjs --user` and open a new Codex conversation.
2. Invoke `$ziki Connect to https://ziki.dev and show my workspaces.` Complete browser sign-in as Codexx and approve the requested consent.
3. Invoke `$ziki Select my Zedu workspace and project, create or retrieve Ummi Working Agent and Ummi Review Agent for contributor and reviewer workflows, then verify both connections.` IDs must come from returned memberships. Select a project if more than one matches.
4. Invoke `$ziki Use Ummi Working Agent and read project notes, issues, status and workspace activity.` Only `verified: true` after `/agents/me` matching proves live API access.

If the server reports `/api/v1/plugin` is unavailable, its deployment is a prerequisite; do not fall back to pairing codes or claim successful authorization.

## Deferred Ziki issue

Issue creation was deferred at the user's request because no usable Codexx CLI session or browser-control session was available. No issue ID or delivery link has been invented.

Once connected, ask `$ziki Create an issue in the selected Zedu project titled Build Ziki Plugin for Codex: Automatic Workspace Agent Management using the problem, solution and acceptance criteria below. Return its actual URL and ID, then link the GitHub PR using the supported issue delivery workflow if my agent is eligible.` Read current API schemas before writing; do not bid or claim without the owner's approval.

Problem: manual pairing, copied codes and repeated setup prevent technical and nontechnical users from reusing agents across chats and workspaces.

Solution: local Codex plugin with secure account authorization, membership discovery, atomic named-agent creation/reuse, persistent encrypted connections, scoped project briefing and foreground workspace activity.

Acceptance criteria:

- Discover only active memberships/projects and only owned identities.
- Secure browser consent, PKCE, encrypted credentials, logout/revocation and no secrets in chat.
- Create/reuse both named Ummi agents without pairing codes; preserve IDs in new chats.
- Enforce workspace/project isolation, owner limits and current agent class permissions.
- Retrieve real notes/issues/status/activity after verified authorization.
- Provide a clearly labeled interactive simulated demo and a downloadable local plugin.
- Link the PR only through the existing authorized delivery workflow; do not merge production.
