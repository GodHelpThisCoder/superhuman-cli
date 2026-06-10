# superhuman-cli

MCP server (45 tools) plus a diagnostics-only CLI to control [Superhuman](https://superhuman.com) email client via Chrome DevTools Protocol (CDP).

All email, label, calendar, snippet, and compose operations are exposed through the **MCP server**. The CLI is a small companion for connection diagnostics, log inspection, and the safety kill switch.

## Requirements

- [Bun](https://bun.sh) runtime
- Superhuman desktop app running with remote debugging enabled

## Setup

```bash
# Install dependencies
bun install

# Start Superhuman with CDP enabled
# macOS:
/Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333

# Windows:
"%LOCALAPPDATA%\Programs\Superhuman\Superhuman.exe" --remote-debugging-port=9333
```

## CLI Usage (diagnostics only)

```bash
# Check connection status
superhuman status

# Full diagnostics: CDP, process, lock, pending updates, tokens, shortcuts
superhuman doctor
superhuman doctor --fix-port        # Gracefully restart Superhuman with the debug port
superhuman doctor --patch-shortcut  # Add the debug-port flag to Windows shortcuts

# Ensure Superhuman is running with the CDP debug port
superhuman launch

# Inspect the MCP server log file
superhuman logs              # Last 50 lines
superhuman logs -n 200       # Last 200 lines
superhuman logs --follow     # Poll for new lines (Ctrl+C to stop)

# Accounts (connection repair)
superhuman account list
superhuman account list --json
superhuman account auth      # Extract and cache OAuth tokens
```

### Safety (kill switch)

```bash
# Activate kill switch — blocks all mutations until deactivated
superhuman kill "reason for suspension"

# Deactivate kill switch
superhuman unkill
```

The audit log of mutations is available through the MCP `superhuman_audit_log` tool.

### Token Management

```bash
# Extract and cache tokens from Superhuman (required once)
superhuman account auth

# Tokens are automatically refreshed when expiring
# If refresh fails, you'll see: "Token for user@email.com expired. Run 'superhuman account auth' to re-authenticate."
```

Tokens are stored in `~/.config/superhuman-cli/tokens.json` and automatically refreshed using OAuth refresh tokens when they expire (within 5 minutes of expiry). No CDP connection is needed for token refresh.

### CLI Options

| Option | Description |
|--------|-------------|
| `--port <number>` | CDP port (default: 9333) |
| `--json` | Output as JSON (for `account list`) |
| `-n <number>` | Number of log lines to print (for `logs`, default: 50) |
| `--follow` | Keep printing new log lines, 1s poll (for `logs`) |
| `--fix-port` | (doctor) Gracefully restart Superhuman with the debug port |
| `--patch-shortcut` | (doctor) Add the debug-port flag to Windows shortcuts |
| `--verbose` | Enable debug logging |
| `--version`, `-v` | Print version |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_PORT` | `9333` | CDP debugging port |
| `CDP_HOST` | `localhost` | CDP host |

Token storage location: `~/.config/superhuman-cli/tokens.json`

## MCP Server

Run as an MCP server for Claude integration:

```bash
bun src/index.ts --mcp
```

### MCP Tools (45)

| Tool | Description |
|------|-------------|
| `superhuman_inbox` | List recent emails from inbox |
| `superhuman_search` | Search emails |
| `superhuman_read` | Read a thread |
| `superhuman_sender_summary` | Get unique senders matching a query, grouped by email with thread counts |
| `superhuman_collect_thread_ids` | Collect all thread IDs matching a query via pagination |
| `superhuman_draft` | Create a draft in Superhuman's native Drafts view (no attachments) |
| `superhuman_send` | Send an email (supports attachments) |
| `superhuman_reply` | Reply to a thread (supports attachments) |
| `superhuman_reply_all` | Reply-all to a thread (supports attachments) |
| `superhuman_forward` | Forward a thread (supports attachments) |
| `superhuman_archive` | Archive thread(s) |
| `superhuman_archive_by_query` | Archive all threads matching a search query |
| `superhuman_unarchive` | Unarchive thread(s) (move back to inbox) |
| `superhuman_delete` | Delete thread(s) |
| `superhuman_mark_read` | Mark thread(s) as read |
| `superhuman_mark_unread` | Mark thread(s) as unread |
| `superhuman_labels` | List all labels |
| `superhuman_get_labels` | Get labels on a thread |
| `superhuman_create_label` | Create a new label |
| `superhuman_add_label` | Add label to thread(s) |
| `superhuman_add_label_by_query` | Add label to all threads matching a search query |
| `superhuman_remove_label` | Remove label from thread(s) |
| `superhuman_star` | Star thread(s) |
| `superhuman_unstar` | Unstar thread(s) |
| `superhuman_starred` | List starred threads |
| `superhuman_snooze` | Snooze thread(s) |
| `superhuman_unsnooze` | Unsnooze thread(s) |
| `superhuman_snoozed` | List snoozed threads |
| `superhuman_attachments` | List attachments in a thread |
| `superhuman_download_attachment` | Download an attachment |
| `superhuman_snippets` | List all snippets |
| `superhuman_snippet` | Use a snippet to compose or send |
| `superhuman_accounts` | List linked accounts |
| `superhuman_switch_account` | Switch to a different account |
| `superhuman_calendar_list` | List calendar events |
| `superhuman_calendar_create` | Create calendar event |
| `superhuman_calendar_update` | Update calendar event |
| `superhuman_calendar_delete` | Delete calendar event |
| `superhuman_calendar_free_busy` | Check free/busy availability |
| `superhuman_ask_ai` | Ask AI to search emails, answer questions, or compose |
| `superhuman_agent_sessions` | List AI sidebar conversations (agent sessions) |
| `superhuman_agent_session_read` | Read a specific agent session transcript |
| `superhuman_status` | Report server version, lifecycle state, Superhuman process/CDP status, pending updates |
| `superhuman_confirm` | Confirm a staged destructive operation using its `shm_` token |
| `superhuman_audit_log` | View the JSONL mutation audit log with optional filters |

> **Dry-run mode:** All mutating tools accept `dryRun: true` to preview the operation without executing it.

#### Attachments on Compose

The send, reply, reply-all, and forward tools accept an optional `attachments` array. Each attachment requires:

| Field | Required | Description |
|-------|----------|-------------|
| `filename` | Yes | Filename (e.g., `"report.pdf"`) |
| `content` | Yes | Base64-encoded file content |
| `mimeType` | No | MIME type (auto-detected from extension if omitted) |

The two-step flow is handled internally: a provider draft is created, attachments are added via Gmail/MS Graph API, then the draft is sent. Auto-detected MIME types include: pdf, docx, xlsx, pptx, png, jpg, gif, csv, json, zip, mp3, mp4, and more.

`superhuman_draft` is the exception: it writes to Superhuman's native draft store (so drafts appear in Superhuman's Drafts view) and does **not** support attachments.

### MCP Agent Guide

Patterns learned from production use with Claude Code agents:

#### CDP Stability Protocol

The MCP server uses CDP for initial account resolution. Under concurrent load, the WebSocket can drop.

```
1. Call superhuman_accounts FIRST (warms 30s CDP cache)
2. Verify the correct account is active; switch if needed
3. Up to 4 parallel tool calls are safe within 30s of step 1
4. On "WebSocket connection closed" or "No current account found":
   STOP → wait 5s → call superhuman_accounts → retry
```

#### Two-Phase Confirmation

All destructive operations (archive, delete, calendar delete) return a confirmation token instead of executing immediately:

```
Stage:   superhuman_archive({threadIds: ["a","b","c"]})
         → Returns: "shm_abc123..." (expires in 120s)
Confirm: superhuman_confirm({token: "shm_abc123..."})
         → Executes the archive
```

For batches >50 items, pass `force: true` to `superhuman_confirm`.

#### Search Features

- **`limit`** (1-50, default 10): Control result count per query
- **`totalResults`**: Approximate match count returned with every search — use `limit: 1` for cheap recon counts
- **`includeDone: true`**: Search all mail including archived (for verification and recovery)

#### Bulk Operations

**`archive_by_query`**: Accepts a search query, internally paginates all matches (up to 500), and stages them for two-phase confirmation. Supports `dryRun: true` for preview and `excludeThreadIds: string[]` to protect specific threads.

**Mixed-sender workflow** (sender has both KEEP and ARCHIVE content):
1. `sender_summary({query: "from:sender@example.com in:inbox"})` — assess volume
2. `collect_thread_ids({query: "from:sender@example.com in:inbox"})` — get all IDs
3. `search` to identify the KEEP threads
4. `archive_by_query({query: "from:sender@example.com in:inbox", excludeThreadIds: [keepIds]})` — bulk archive minus KEEPs

**`add_label_by_query`**: Same pattern as `archive_by_query` but for labeling. Up to 500 threads, supports `excludeThreadIds`.

#### Recon Tools

- **`sender_summary`**: Returns top 50 senders matching a query, grouped by email with thread counts. Use before bulk operations.
- **`collect_thread_ids`**: Read-only — returns all thread IDs matching a query. Use for building exclude lists.

#### Calendar Note

For Claude Code workflows, prefer the `morgen` CLI for calendar operations — it supports proper calendar filtering. See the `/morgen` skill.

### Claude Desktop Configuration

Add to your Claude Desktop config:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "superhuman": {
      "command": "bun",
      "args": ["/path/to/superhuman-cli/src/index.ts", "--mcp"]
    }
  }
}
```

## How It Works

### Direct API (Primary)

Most operations use **direct Gmail API and Microsoft Graph API** calls with cached OAuth tokens:

| Operation | Gmail API | MS Graph API |
|-----------|-----------|--------------|
| List inbox | `GET /messages?q=label:INBOX` | `GET /mailFolders/Inbox/messages` |
| Search | `GET /messages?q=...` | `GET /messages?$search=...` |
| Labels | `POST /threads/{id}/modify` | `PATCH /messages/{id}` |
| Read status | Add/remove UNREAD label | `PATCH /messages/{id}` with `isRead` |
| Archive | Remove INBOX label | `POST /messages/{id}/move` |
| Star | Add STARRED label | `PATCH /messages/{id}` with `flag` |
| Attachments (read) | `GET /messages/{id}/attachments/{id}` | `GET /messages/{id}/attachments/{id}` |
| Attachments (write) | MIME rebuild on draft | `POST /messages/{id}/attachments` |
| Calendar events | Google Calendar API | MS Graph Calendar API |
| Free/busy | `POST /freeBusy` | `POST /me/calendar/getSchedule` |
| Drafts (native) | Superhuman backend API | Superhuman backend API |
| Snippets | Superhuman backend API | Superhuman backend API |

OAuth tokens (including refresh tokens) are extracted from Superhuman and cached to disk. When tokens expire, they are automatically refreshed via OAuth endpoints without requiring CDP connection.

### CDP (Secondary)

Chrome DevTools Protocol is only needed for:

- `account auth` — One-time token extraction from `window.GoogleAccount` (also stores AI user prefix)
- `status` / `doctor` / `launch` — Connection diagnostics and app lifecycle
- Account resolution — Determining which account is active in the Superhuman UI
- Agent sessions — Reading AI sidebar conversations via Superhuman's portal API
- `search` / `inbox` (when no cached tokens) — Fallback via Superhuman's portal API

All other operations (read, reply, forward, draft, archive, delete, labels, star, snooze, attachments, calendar, snippets) use direct API with cached tokens.

### Benefits

- **Reliability**: Direct API calls don't depend on Superhuman's UI state
- **Speed**: No CDP round-trips for most operations
- **Offline from CDP**: After initial `account auth`, most operations work without CDP
- **Multi-account**: Cached tokens enable operating on any linked account

Supports both Gmail and Microsoft/Outlook accounts.

## License

MIT
