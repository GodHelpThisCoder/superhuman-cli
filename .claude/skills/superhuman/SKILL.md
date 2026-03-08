---
name: superhuman
description: This skill should be used when the user asks to "check email", "read inbox", "send email", "reply to email", "search emails", "archive email", "snooze email", "star email", "add label", "forward email", "download attachment", "switch email account", "use snippet", "search contacts", "ask ai about email", "find email about", "what did someone say about", or needs to interact with Superhuman email client. For calendar, events, and scheduling use the morgen skill instead.
allowed-tools: Bash(superhuman:*)
---

# Superhuman Email Automation

See `Q:\Claude\Superhuman-Mail-Automation\superhuman-cli\README.md` for full CLI documentation, command reference, and architecture details.

## Key Caveats

- **Calendar:** DO NOT use `superhuman calendar`. Use the `morgen` CLI for all calendar operations — it supports proper calendar filtering. See the `/morgen` skill.
- **Working directory:** `Q:\Claude\Superhuman-Mail-Automation\superhuman-cli`
- **Runtime:** Bun (not Node.js)
- **CDP port:** 9333 (default)

## Quick Reference

```bash
# Common commands
superhuman inbox                          # List inbox
superhuman search "query"                 # Search emails
superhuman read <thread-id> --account <email>  # Read thread
superhuman reply <thread-id> --body "..."      # Draft reply
superhuman reply <thread-id> --body "..." --send  # Send reply
superhuman ai "natural language query"         # Ask AI
superhuman draft create --to <email> --subject "..." --body "..."
superhuman account auth                        # Re-extract tokens
superhuman account list                        # List accounts
```

## Token Management

Tokens auto-refresh. If expired: `superhuman account auth` to re-extract from Superhuman via CDP.
Tokens stored at `~/.config/superhuman-cli/tokens.json` (AES-256-GCM encrypted).

## Troubleshooting

1. **Connection failed:** Ensure Superhuman is running with `--remote-debugging-port=9333`
2. **Token expired:** Run `superhuman account auth`
3. **Thread not found:** Use `superhuman inbox --json | jq '.[0].id'` to get exact IDs
