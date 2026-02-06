---
name: superhuman
description: This skill should be used when the user asks to "check email", "read inbox", "send email", "reply to email", "search emails", "archive email", "snooze email", "star email", "add label", "forward email", "download attachment", "switch email account", "check calendar", "list events", "create event", "schedule meeting", "check availability", "free busy", "use snippet", "search contacts", or needs to interact with Superhuman email client or calendar.
---

# Superhuman Email & Calendar Automation

Automate Superhuman email client via CLI or MCP server. Most operations use direct Gmail/MS Graph API with cached OAuth tokens. CDP is only needed for initial auth and status checks.

## Prerequisites

Extract OAuth tokens first (one-time, requires Superhuman running with CDP):

```bash
/Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333
superhuman account auth
```

## CLI Usage

### Status & Accounts

```bash
superhuman status                                    # Check connection
superhuman account auth                              # Extract & cache OAuth tokens
superhuman account list                              # List linked accounts
superhuman account list --json
superhuman account switch 2                          # Switch by index
superhuman account switch user@example.com           # Switch by email
```

### Inbox & Search

```bash
superhuman inbox                                     # List recent inbox
superhuman inbox --limit 20 --json
superhuman search "from:john subject:meeting"
superhuman search "project update" --limit 20
superhuman search "from:anthropic" --include-done    # Search all (not just inbox)
```

### Read Threads

The `read` command requires `--account` and fetches full message bodies via direct API:

```bash
superhuman read <thread-id> --account user@gmail.com
superhuman read <thread-id> --account user@gmail.com --context 3   # Full body for last 3 only
superhuman read <thread-id> --account user@gmail.com --json
```

### Reply / Forward

```bash
superhuman reply <thread-id> --body "Thanks!"
superhuman reply <thread-id> --body "Got it" --send
superhuman reply-all <thread-id> --body "Thanks everyone"
superhuman forward <thread-id> --to user@example.com --body "FYI" --send
```

### Compose & Send

Recipients can be email addresses or contact names (auto-resolved):

```bash
superhuman send --to user@example.com --subject "Hello" --body "Hi there"
superhuman send --to "john" --subject "Hello" --body "Hi there"
superhuman compose --to user@example.com --subject "Meeting"       # Opens UI
```

### Drafts

```bash
superhuman draft create --to user@example.com --subject "Hello" --body "Draft content"
superhuman draft update <draft-id> --body "Updated content"
superhuman draft delete <draft-id>
superhuman draft send <draft-id> --account=user@example.com --to=recipient@example.com --subject="Subject" --body="Body"
```

### Archive / Delete

```bash
superhuman archive <thread-id>
superhuman archive <thread-id1> <thread-id2>
superhuman delete <thread-id>
```

### Mark Read/Unread

```bash
superhuman mark read <thread-id>
superhuman mark unread <thread-id1> <thread-id2>
```

### Star

```bash
superhuman star add <thread-id>
superhuman star add <thread-id1> <thread-id2>
superhuman star remove <thread-id>
superhuman star list
superhuman star list --json
```

### Labels

```bash
superhuman label list
superhuman label list --json
superhuman label get <thread-id>
superhuman label add <thread-id> --label Label_123
superhuman label remove <thread-id> --label Label_123
```

### Snooze

```bash
superhuman snooze set <thread-id> --until tomorrow
superhuman snooze set <thread-id> --until next-week
superhuman snooze set <thread-id> --until "2024-02-15T14:00:00Z"
superhuman snooze cancel <thread-id>
superhuman snooze list
superhuman snooze list --json
```

### Attachments

```bash
superhuman attachment list <thread-id>
superhuman attachment list <thread-id> --json
superhuman attachment download <thread-id>
superhuman attachment download <thread-id> --output ./downloads
superhuman attachment download --attachment <attachment-id> --message <message-id> --output ./file.pdf
```

### Contacts

```bash
superhuman contact search "john"
superhuman contact search "john" --limit 5 --json
superhuman contact search "john" --account user@gmail.com
```

### Snippets

Reusable email templates with template variables:

```bash
superhuman snippet list
superhuman snippet list --json
superhuman snippet use "zoom link" --to user@example.com
superhuman snippet use "share recordings" --to user@example.com --vars "date=Feb 5,student_name=Jane"
superhuman snippet use "share recordings" --to user@example.com --vars "date=Feb 5" --send
```

### Calendar

```bash
superhuman calendar list                              # Today's events
superhuman calendar list --date tomorrow --range 7    # Week from tomorrow
superhuman calendar list --json
superhuman calendar create --title "Meeting" --start "2pm" --duration 30
superhuman calendar create --title "All Day" --date 2026-02-05
superhuman calendar update --event <event-id> --title "New Title"
superhuman calendar delete --event <event-id>
superhuman calendar free                              # Today's availability
superhuman calendar free --date tomorrow --range 7
```

### AI

```bash
superhuman ai <thread-id> "summarize this thread"
superhuman ai <thread-id> "what are the action items?"
superhuman ai "draft an email about project status"   # Compose mode (no thread)
```

## MCP Server Usage

Run as MCP server for Claude Code integration:

```bash
superhuman --mcp
```

Configure in Claude Code settings:

```json
{
  "mcpServers": {
    "superhuman": {
      "command": "superhuman",
      "args": ["--mcp"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `superhuman_inbox` | List recent inbox threads |
| `superhuman_search` | Search emails by query |
| `superhuman_read` | Read a specific thread |
| `superhuman_send` | Compose and send email |
| `superhuman_draft` | Create and save draft |
| `superhuman_reply` | Reply to thread |
| `superhuman_reply_all` | Reply-all to thread |
| `superhuman_forward` | Forward thread |
| `superhuman_archive` | Archive thread(s) |
| `superhuman_delete` | Delete (trash) thread(s) |
| `superhuman_mark_read` | Mark as read |
| `superhuman_mark_unread` | Mark as unread |
| `superhuman_labels` | List available labels |
| `superhuman_get_labels` | Get labels on thread |
| `superhuman_add_label` | Add label to thread(s) |
| `superhuman_remove_label` | Remove label from thread(s) |
| `superhuman_star` | Star thread(s) |
| `superhuman_unstar` | Unstar thread(s) |
| `superhuman_starred` | List starred threads |
| `superhuman_snooze` | Snooze until time |
| `superhuman_unsnooze` | Cancel snooze |
| `superhuman_snoozed` | List snoozed threads |
| `superhuman_attachments` | List attachments |
| `superhuman_download_attachment` | Download attachment |
| `superhuman_accounts` | List linked accounts |
| `superhuman_switch_account` | Switch active account |
| `superhuman_calendar_list` | List calendar events |
| `superhuman_calendar_create` | Create calendar event |
| `superhuman_calendar_update` | Update calendar event |
| `superhuman_calendar_delete` | Delete calendar event |
| `superhuman_calendar_free_busy` | Check availability |
| `superhuman_snippets` | List all snippets |
| `superhuman_snippet` | Use a snippet to compose/send |

## Common Workflows

### Triage Inbox

```bash
superhuman inbox --limit 20
superhuman read <thread-id> --account user@gmail.com
superhuman archive <thread-id1> <thread-id2>
superhuman snooze set <thread-id> --until tomorrow
superhuman star add <thread-id>
```

### Reply to Email

```bash
superhuman read <thread-id> --account user@gmail.com
superhuman reply <thread-id> --body "Thanks for the update." --send
```

### Search and Process

```bash
superhuman search "from:boss@company.com" --limit 10
superhuman search "is:unread has:attachment"
superhuman search "from:anthropic" --include-done    # Include archived
```

### Multi-Account

```bash
superhuman account list
superhuman account switch work@company.com
superhuman contact search "john" --account personal@gmail.com
```

### Calendar Management

```bash
superhuman calendar list
superhuman calendar list --range 7
superhuman calendar free --date tomorrow
superhuman calendar create --title "Team Sync" --start "2pm" --duration 60
superhuman calendar update --event <event-id> --start "3pm"
superhuman calendar delete --event <event-id>
```

### Snippets

```bash
superhuman snippet list
superhuman snippet use "meeting invite" --to colleague@example.com --vars "date=Feb 10" --send
```

## Snooze Presets

| Preset | When |
|--------|------|
| `tomorrow` | 9am next day |
| `next-week` | 9am next Monday |
| `weekend` | 9am Saturday |
| `evening` | 6pm today |
| ISO datetime | Exact time (e.g., `2024-02-15T14:00:00Z`) |

## Output Formats

Most commands support `--json` for structured output:

```bash
superhuman inbox --json | jq '.[] | {id, subject, from}'
```

## Troubleshooting

### Token Expired

```bash
superhuman account auth    # Re-extract tokens from Superhuman
```

Tokens auto-refresh. If refresh fails: `Token for user@email.com expired. Run 'superhuman account auth' to re-authenticate.`

### Connection Failed

1. Check if Superhuman is installed at `/Applications/Superhuman.app`
2. Launch with debugging: `/Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333`
3. Verify: `superhuman status`

### Thread Not Found

Thread IDs come from inbox/search. Use `--json` to get exact IDs:

```bash
superhuman inbox --json | jq '.[0].id'
```
