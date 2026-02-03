# Feature Backlog

## Email CLI Enhancement

### Completed
- [x] Inbox/Search/Read - Core email reading functionality
- [x] Account Discovery & Switching - List and switch between linked accounts
- [x] Reply/Forward functionality - Reply, reply-all, forward commands
- [x] Archive/Delete commands - Archive and delete with server persistence
- [x] Labels/Folders management - List, get, add, remove labels
- [x] Mark read/unread - Mark threads as read or unread
- [x] Star/unstar threads - Star, unstar, list starred (Gmail labels + Microsoft flags)
- [x] Snooze functionality - Snooze, unsnooze, list snoozed with presets and custom times
- [x] Attachments support - List, download, upload attachments

### Next Up
- [ ] (awaiting user input)

## Draft System Documentation

**Status:** Documented (limitation accepted)

### How Drafts Work Now

Drafts are created via **native Gmail/Outlook APIs** (commit 7fc3dcc):
- Gmail: `POST /gmail/v1/users/me/drafts`
- Outlook: `POST /me/messages`

### Known Limitation

**Superhuman UI does NOT display native drafts.** Superhuman has its own proprietary drafts system that is completely separate from native email drafts.

| Where | Visible? |
|-------|----------|
| Native Gmail/Outlook web | ✓ Yes |
| Native mobile apps | ✓ Yes |
| Superhuman UI | ✗ No |

### Workflow

This is acceptable because:
1. CLI is used to iterate on drafts with LLMs (no need for Superhuman UI)
2. Can edit drafts via native email apps if needed
3. `--send` flag sends immediately when ready

### Future Enhancement (optional)

Could add a feature to copy a native draft into a Superhuman compose window:
1. Read draft content via API
2. Open Superhuman compose window
3. Paste content into compose
4. User can then edit/send via Superhuman UI

**Priority:** Low - only if manual Superhuman editing is frequently needed
