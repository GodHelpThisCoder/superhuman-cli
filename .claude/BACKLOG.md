# Feature Backlog

## Feature 2: Add Superhuman Native Drafts — COMPLETE

**Status:** Complete (SuperhumanDraftProvider implemented with tests)

**Description:** Add SuperhumanDraftProvider to fetch native drafts from `userdata.getThreads` endpoint

**Implementation:**
- `src/providers/superhuman-draft-provider.ts` — SuperhumanDraftProvider class
- `src/__tests__/superhuman-draft-provider.test.ts` — Tests
- Registered in DraftService; native drafts appear via `superhuman draft list`

**API Endpoint:** `POST https://mail.superhuman.com/~backend/v3/userdata.getThreads`
- Request: `{ "filter": { "type": "draft" }, "offset": 0, "limit": 25 }`
