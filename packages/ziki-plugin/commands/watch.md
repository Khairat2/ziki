---
description: Check workspace activity or watch briefly in the foreground
---
User request: $ARGUMENTS

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ziki.mjs" watch once` for an on-demand snapshot, `watch status` for monitoring configuration, or `watch run SECONDS` (1–300 seconds) when the user requests a bounded live watch. Use workspaces and agents list to resolve the requested workspace and project; connect an owned agent with agents use first. Never monitor a different workspace silently. Output includes all active workspace projects' issue/question/approval events, unanswered questions for this owner and actual pending workspace approvals. Persisted cursors prevent re-reading delivered event pages. First checks may return historical events; hasMore means more pages remain. Announce that foreground monitoring ends when the process exits. There is no scheduler, webhook or push notification into future chats configured by this plugin. Do not claim continuous background monitoring. Do not take actions or grant approvals in response to notifications without the owner's authorization.
