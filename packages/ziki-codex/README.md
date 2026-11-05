# Local Codex plugin and interactive demo

This package is not published in the official Plugins Directory. Build a portable local plugin with `pnpm --dir packages/ziki-codex build`; output is `dist/ziki` and includes `.codex-plugin/plugin.json`, the native `$ziki` skill, and the shared runtime. In Codex desktop use the local plugin installation flow supported by your version; alternatively use the standalone installer below. Do not interpret the interactive demo as an actual directory listing.

The PR adds `/api/v1/plugin` browser consent and account management, an encrypted grant table (deploy migrations first), server membership/ownership checks, atomic named-agent reuse and project keys. Contributor and reviewer are workflow purposes, both use the current working class. Existing agent classes are preserved; no manager/merger grants. Production must deploy this backend before live sign-in works.

The static `demo/` is explicitly simulated, has no account credentials, and stores only fictional agent metadata in localStorage. It supports installation, authorization, workspace switching, both Ummi identities, new-chat reuse, project briefing and on-demand activity. Run Node tests with `pnpm --dir packages/ziki-codex test`.

# Ziki for Codex in VS Code

This is a native `$ziki` skill using the existing Ziki 0.2 CLI, backend and encrypted credential vault unchanged. No Claude subscription, new MCP server, OpenAI API integration or new backend is required. Codex itself needs your normal authorized account/access.

The [official skills documentation](https://learn.chatgpt.com/docs/build-skills) supports standalone skills in the Codex IDE extension, `$` invocation, repository `.agents/skills` and user `~/.agents/skills`. MCP is also supported, but adds configuration without helping reuse this CLI's workspace/agent management.

## Install

Run in this repository's root from the VS Code terminal, with Node 22 or newer:

```powershell
node packages/ziki-codex/install.mjs --user
```

This installs a self-contained skill in your OS user's `~/.agents/skills/ziki`, copying three existing runtime files byte for byte. It works from other repositories even if this checkout moves. It does not read/change credentials or change Claude's plugin. Re-run the same command to update a managed installation. It refuses to overwrite an unrelated existing skill.

Alternatively, `node packages/ziki-codex/install.mjs --project` installs only for the current repository. Choose one scope to avoid duplicate skill entries. Open a **new Codex conversation** in VS Code and type `$ziki` in the skill selector. If it is absent, run **Developer: Reload Window** and start a new conversation. For WSL/SSH, install in the environment where Codex executes; a native Windows install is recommended here because the existing runtime uses Windows DPAPI. Do not copy Windows credentials to WSL.

## Sign in and use

```text
$ziki Connect to Ziki and show my workspaces and agents.
$ziki Create two agents in the Zedu workspace named Ummi Working Agent and Ummi Review Agent, with contributor and reviewer roles.
$ziki Switch to Zedu and show my agents.
$ziki Show project notes, available issues and agent status.
$ziki Check workspace activity and pending approvals.
$ziki Show watcher status.
```

Browser sign-in uses your existing Ziki account and explicit authorization. Keep its command running until the callback completes. Names/projects are resolved from returned memberships, not guessed; ambiguous projects require a choice. Contributor/reviewer map to the existing working/reviewing CLI roles. Existing agents and keys are reused, including across new chats. Membership, ownership, role rules, revocation checks, audits and agent limits are unchanged.

The skill shares the existing OS-user vault with Claude: Windows DPAPI or Linux Secret Service (`secret-tool` and an unlocked keyring). Sign-in may already be available without another browser flow. Credentials never enter prompts or command arguments. Disconnecting either integration clears their shared local connection. macOS and remote-browser callbacks remain unsupported. A verified API connection is not a running autonomous worker. Watch checks are on demand or bounded foreground polls, not continuous background notifications.

**Server prerequisite:** the existing `/api/v1/plugin` backend from Ziki 0.2 must already run on your server. This adapter does not deploy it. For local testing run the existing configured application, then ask `$ziki Connect to http://localhost:3001` (the app's site URL must match). No database reseeding is needed or allowed. See the [shared runtime guide](../ziki-plugin/README.md) for backend prerequisites and supported workflows.

## Test

The CLI checks the existing `/api/v1/plugin` handler before opening browser authorization, with a bounded network timeout. A missing production endpoint is a backend deployment blocker, not a request to pair agents manually. It does not silently fall back to localhost or another OAuth flow. Existing account sessions and named-agent reuse remain in the shared encrypted vault; installing the adapter cannot make an undeployed server endpoint available. Reinstall the managed skill after updating the shared runtime.

From the repository root:

```powershell
pnpm --dir packages/ziki-codex test
pnpm --dir packages/ziki-plugin test
```

After personal installation, smoke-test the installed CLI without authentication or network access:

```powershell
node "$HOME/.agents/skills/ziki/scripts/ziki.mjs" workflows
```

For live acceptance, start a new VS Code Codex chat, connect, create/reuse the requested agents, then start another chat and ask `$ziki Show my agents and verify my working agent's connection`. Verify that IDs match and that current `/agents/me` checks succeed. Test notes/issues and `watch once` separately. Do not claim sign-in or agents are online based on an offline test. Host execution/network approvals may be needed for the browser callback, OS vault and API requests; the skill does not bypass them.

Automated tests install into a temporary directory, verify byte-identical reuse and execution outside the checkout, exercise creation/reconnection through the copied CLI with test API responses, check secret-free output and preserve unmanaged skills. Actual VS Code invocation and live sign-in require an interactive user session.
