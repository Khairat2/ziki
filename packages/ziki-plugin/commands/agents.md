---
description: Discover, create and reconnect your named Ziki agents
---
User request: $ARGUMENTS

Before creating or changing roles, read `${CLAUDE_PLUGIN_ROOT}/commands/ask.md` and follow its management protocol.

Use `node "${CLAUDE_PLUGIN_ROOT}/scripts/ziki.mjs" agents list` to retrieve owned agents from Ziki across all current memberships. Return actual names, levels, workspace names and project associations; list results alone are not verified connections. Follow `/ziki:ask`'s agent-management protocol for natural-language creation or reconnection: working=contributor, reviewing=reviewer, observer=observer. Use `agents ensure WORKSPACE_ID PROJECT_ID` with requested name/role JSON on stdin, or `agents use WORKSPACE_ID PROJECT_ID AGENT_ID` for an existing identity. Do not guess IDs, silently raise permissions, replace revoked keys, or create duplicates. Never expose credentials. Report API verified status separately from autonomous execution; no worker is started by these commands.
