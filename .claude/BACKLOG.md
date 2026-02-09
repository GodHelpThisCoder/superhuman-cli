# Feature Backlog

## Feature 2: Add Superhuman Native Drafts

**Status:** Blocked by Feature 1 (DraftService refactor)

**Description:** Add SuperhumanDraftProvider to fetch native drafts from `userdata.getThreads` endpoint

**Tasks:**
1. Create `SuperhumanDraftProvider` class
2. Implement `userdata.getThreads` API call with authentication
3. Parse response and map to draft format
4. Register provider in DraftService
5. Update tests to verify native drafts appear

**API Endpoint:** `POST https://mail.superhuman.com/~backend/v3/userdata.getThreads`
- Request: `{ "filter": { "type": "draft" }, "offset": 0, "limit": 25 }`
- Response: See `.claude/SPEC.md` exploration findings

**Success Criteria:**
- [ ] `superhuman draft list` shows native drafts (IDs like `draft00...`)
- [ ] Native drafts tagged with `source: "native"`
- [ ] Works for both Gmail and Outlook accounts

**Start:** After Feature 1 merges to main
