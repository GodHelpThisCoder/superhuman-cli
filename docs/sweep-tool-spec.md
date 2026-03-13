# Parallel Inbox Sweep — Implementation-Ready Tool Spec

## Context

~5,000-6,000 threads remain in shawnmsorrell@gmail.com inbox (Jul 2014–Mar 2026).
Strategy: 12 subagents scan annual date windows, write categorized results to files,
main thread consolidates and presents for human-approved archiving across 3 sessions.

This spec synthesizes the original wishlist with an MCP protocol compliance audit.
All proposals include `outputSchema`, `annotations`, error design, and `additionalProperties: false`.

---

## Global Requirements (apply to ALL changes below)

### GR-1: `outputSchema` on every tool
The current 40 tools return untyped `content: [{type: "text", text: "..."}]`. Every new or
modified tool MUST declare an `outputSchema` (MCP §2.2) and return `structuredContent` (§2.4)
alongside the human-readable text content. This enables agents to parse responses without
regex/string-matching.

### GR-2: `annotations` on every tool
Every tool MUST declare annotations (MCP §2.7):
- `readOnlyHint`: true/false
- `destructiveHint`: true/false
- `idempotentHint`: true/false
- `openWorldHint`: true/false

### GR-3: `additionalProperties: false` on all input schemas
Per MCP §3.3, all `inputSchema` objects MUST include `"additionalProperties": false`.

### GR-4: `instructions` field update
The MCP server's `instructions` text (injected into LLM system prompt, §2.1) MUST be updated
whenever tools are added or signatures change, so LLMs know when/how to use them.

### GR-5: Actionable error messages (§3.5)
All error responses MUST include:
- What went wrong (specific, not generic)
- Why it failed (backend constraint, invalid input, etc.)
- What the agent should do next (retry with different params, fall back to alternative tool, etc.)

---

## P0 — Build These First

### P0-1: `totalResults` in search responses

**Change type:** Modify existing `superhuman_search`
**MCP compliance:** ✅ Matches §3.6 pagination metadata pattern

**Input schema change:** None — this is output-only.

**Output schema addition:**
```jsonc
{
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": { "$ref": "#/$defs/ThreadSummary" }
    },
    "totalResults": {
      "type": "integer",
      "description": "Total number of threads matching the query (may be approximate). Present even when results are paginated."
    },
    "query": {
      "type": "string",
      "description": "The query that was executed"
    }
  },
  "required": ["results", "query"],
  "additionalProperties": false
}
```

**Notes:**
- `totalResults` is optional in the schema (not in `required`) because the backend may not
  always provide it. When absent, agents fall back to pagination-based counting.
- If the Gmail/Superhuman backend returns `resultSizeEstimate` (Gmail API does), surface it.
  If not, omit the field rather than fabricating a count.

**Annotations:**
```json
{ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

**Error cases:**
| Condition | Error message |
|---|---|
| Invalid query syntax | `"Invalid search query: {details}. Superhuman search supports Gmail-style operators: from:, to:, subject:, in:, before:, after:, OR. Check operator spelling and quoting."` |
| Backend timeout | `"Search timed out after {N}ms. Try narrowing the date range with before:/after: operators, or reduce limit."` |

**Impact:** Eliminates reconnaissance phase. Saves ~20 API calls per sweep.

---

### P0-2: Configurable search `limit` (up to 50)

**Change type:** Modify existing `superhuman_search`
**MCP compliance:** ✅ Matches §3.6 "Guard the Token Budget"

**Input schema change:**
```jsonc
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query string" },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "default": 10,
      "description": "Maximum number of results to return (1-50). Default: 10."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

**Annotations:** Same as P0-1 (read-only, idempotent).

**Error cases:**
| Condition | Error message |
|---|---|
| `limit > 50` | `"limit must be between 1 and 50. The Superhuman backend rejects requests above ~50. Use before:/after: date anchoring to paginate larger result sets."` |
| `limit` not integer | `"limit must be an integer, got {type}."` |
| Backend rejects limit | `"Backend rejected limit={N} (HTTP 400). Try limit=50 or lower. The backend's maximum may have changed."` |

**Implementation note:** The current MCP tool hardcodes `limit: 10` in the `superhuman_search`
tool definition but documents say 20 in practice. Clarify: the backend `userdata.getThreads`
has been tested up to ~50 before HTTP 400. Pass `limit` through directly. Default should be
10 (current behavior) for backward compatibility, but agents can request up to 50.

**Impact:** 60% reduction in pagination calls. Biggest bang-for-buck.

---

### P0-3: Archive by search query — REDESIGNED per audit

**Audit finding:** Original design violated §3.7/§8.3 "Separate read and write tools" by
mixing search (read) and archive (write) in one call.

**Redesigned approach: Pure write tool that accepts a query as input**

The tool does NOT search — it accepts a query, resolves matching threadIds internally,
and stages them for archive. The agent has already done the search separately (via
`superhuman_search`) and decided what query to use. This tool is purely a write operation
that happens to accept a query instead of explicit threadIds.

**Tool name:** `superhuman_archive_by_query`

**Input schema:**
```jsonc
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query whose matching threads will be staged for archive. The agent should have already run this query via superhuman_search to verify what it matches."
    },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "Preview what would be archived without staging. Returns matched threads and count."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

**Annotations:**
```json
{ "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false }
```

**Output schema:**
```jsonc
{
  "type": "object",
  "properties": {
    "matchedCount": { "type": "integer" },
    "threads": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "threadId": { "type": "string" },
          "from": { "type": "string" },
          "subject": { "type": "string" },
          "date": { "type": "string" }
        }
      }
    },
    "confirmToken": {
      "type": "string",
      "description": "Confirmation token for superhuman_confirm. Absent in dryRun mode."
    },
    "expiresIn": { "type": "integer", "description": "Token expiry in seconds" },
    "anomalies": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Senders appearing <5% in batch, grouped by root domain"
    }
  },
  "required": ["matchedCount", "threads"],
  "additionalProperties": false
}
```

**Behavior:**
1. Internally executes the query, paginating to collect ALL matching threadIds (not just first page)
2. Returns full thread list + count in staging response (like current `superhuman_archive`)
3. Requires `superhuman_confirm` to execute (existing two-phase flow)
4. `dryRun: true` returns matched threads without staging — no token generated
5. Anomaly flags use domain-grouped format (see P2-8)

**Error cases:**
| Condition | Error message |
|---|---|
| Query matches 0 threads | `"Query matched 0 threads: '{query}'. Verify the query returns results with superhuman_search first."` |
| Query matches >500 threads | `"Query matched {N} threads (>500). This is unusually large. Add date range or sender filters to narrow the query, or pass dryRun: true to preview matches."` |
| Internal pagination fails | `"Failed to collect all matching threads (got {N} of estimated {total}). Try a narrower query."` |

**`instructions` update:**
```
superhuman_archive_by_query: Archives all threads matching a search query. ALWAYS run
the query through superhuman_search first to verify matches before using this tool.
Use for bulk cleanup of known-archivable senders (e.g., "from:codecademy in:inbox").
Requires superhuman_confirm to execute. Use dryRun:true to preview without staging.
```

**Impact:** Collapses search→paginate→collect→stage→confirm loop to verify→stage→confirm.

---

## P1 — Build If Feasible

### P1-4: Search `offset` / pagination parameter

**Change type:** Modify existing `superhuman_search`

**Input schema addition:**
```jsonc
{
  "offset": {
    "type": "integer",
    "minimum": 0,
    "default": 0,
    "description": "Number of results to skip before returning. Use with limit for pagination. Note: backend support varies — if offset is not supported, results fall back to date-anchored pagination and this field is ignored. Check the 'offsetSupported' field in the response."
  }
}
```

**Output schema addition:**
```jsonc
{
  "offsetSupported": {
    "type": "boolean",
    "description": "Whether the backend honored the offset parameter. If false, results start from the beginning regardless of offset value."
  }
}
```

**Annotations:** Same as search (read-only, idempotent).

**Error cases:**
| Condition | Error message |
|---|---|
| Offset beyond result set | `"Offset {N} exceeds total results ({total}). Use totalResults to determine valid offset range."` |
| Backend doesn't support offset | Return results from beginning with `offsetSupported: false` (NOT an error — graceful degradation) |

**Caveat:** Gmail API uses `pageToken` not numeric offset. If the Superhuman backend similarly
uses opaque cursor tokens, expose those instead:
```jsonc
{
  "nextPageToken": { "type": "string", "description": "Pass as pageToken in next request to get next page" },
  "pageToken": { "type": "string", "description": "Opaque cursor from previous response's nextPageToken" }
}
```
This is still better than date-anchoring because it's explicit and won't miss threads
with identical timestamps.

---

### P1-5: Richer thread metadata in search results

**Change type:** Modify existing `superhuman_search` output

**Output schema — ThreadSummary definition:**
```jsonc
{
  "$defs": {
    "ThreadSummary": {
      "type": "object",
      "properties": {
        "threadId": { "type": "string" },
        "from": { "type": "string" },
        "subject": { "type": "string" },
        "date": { "type": "string", "format": "date-time" },
        "snippet": { "type": "string" },
        "messageCount": {
          "type": "integer",
          "description": "Number of messages in thread. 1 = single message (likely automated/marketing)."
        },
        "hasAttachments": {
          "type": "boolean",
          "description": "Whether any message in the thread has attachments."
        },
        "isUnread": {
          "type": "boolean",
          "description": "Whether the thread is unread."
        },
        "labels": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Labels/folders on the thread."
        },
        "sizeEstimate": {
          "type": "integer",
          "description": "Estimated thread size in bytes."
        }
      },
      "required": ["threadId", "from", "subject", "date", "snippet"],
      "additionalProperties": false
    }
  }
}
```

**Implementation notes:**
- All new fields are optional (not in `required`). Only include what the backend provides.
- Gmail API `threads.list` with `fields` parameter can return `messages.payload.headers`,
  `messages.payload.mimeType`, `resultSizeEstimate`. Map these to the schema fields.
- If the Superhuman backend's `userdata.getThreads` doesn't return these, check if a
  supplementary `threads.get` call per thread is feasible (likely too expensive for bulk;
  in that case, only include fields available from the list endpoint).

**Error cases:** None specific — fields are optional, absent = unknown.

---

### P1-6: Batch search — REDESIGNED per audit

**Audit findings:**
- Violates §3.1 "Design for Outcomes, Not Operations" — batching is an orchestrator optimization
- Token budget risk (§3.6) — multiple queries × results = unbounded response

**Decision: DOWNGRADE to P2 / DEFER**

The audit is right — this is an operational optimization that doesn't serve a distinct user
outcome. The real bottleneck is pagination within a single query (addressed by P0-2 limit
increase and P1-4 offset). Batch search adds complexity for marginal gain.

If implemented despite this, requirements:
- Per-query `limit` cap (max 10 per query in batch mode)
- Max 5 queries per batch
- Total response token guard: if combined results exceed ~8,000 tokens, truncate with
  `"truncated": true` per query
- `annotations`: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }`

**Recommendation:** Skip this. The subagent architecture naturally parallelizes queries across
agents. Batch search solves a problem that subagents already solve.

---

## P2 — Nice-to-Have Refinements

### P2-7: `countOnly` search mode

**Change type:** Modify existing `superhuman_search`

**Input schema addition:**
```jsonc
{
  "countOnly": {
    "type": "boolean",
    "default": false,
    "description": "Return only the count of matching threads, not the threads themselves. Faster and uses fewer tokens."
  }
}
```

**Output when `countOnly: true`:**
```jsonc
{
  "type": "object",
  "properties": {
    "count": { "type": "integer" },
    "query": { "type": "string" }
  },
  "required": ["count", "query"],
  "additionalProperties": false
}
```

**Annotations:** Same as search (read-only, idempotent).

**Error cases:**
| Condition | Error message |
|---|---|
| Backend doesn't support count-only | Fall back to running the full query and counting results. Return count with a note: `"countMethod": "exhaustive"` (vs `"native"` if backend supports it). |

**Note:** Redundant if P0-1 `totalResults` is implemented. Build only if `totalResults` is
infeasible.

---

### P2-8: Domain-grouped anomaly flags

**Change type:** Modify anomaly detection in archive staging

**Current:** Each unique sender email flagged separately when <5% of batch.
**Proposed:** Group by root domain (eTLD+1).

**Output format change:**
```
// Before:
WARNING: Anomalous senders (<5% of batch):
  - mail7@creditkarma.com (1 thread)
  - savings4@creditkarma.com (1 thread)
  - mail10@creditkarma.com (1 thread)

// After:
WARNING: Anomalous senders (<5% of batch):
  - *.creditkarma.com (3 threads across 3 subdomains)
```

**Implementation:** Use a public suffix list or simple heuristic (take last 2 domain segments,
or last 3 if second-to-last is `co`/`com`/`org`/etc.) to group.

---

### P2-9: Archive chunking for >50 items

**Change type:** Modify existing `superhuman_archive`

**Audit concern:** Single token for 200+ archives reduces oversight granularity.

**Revised design — automatic chunking with per-chunk visibility:**
```jsonc
// Staging response for 200 threads:
{
  "totalThreads": 200,
  "chunks": [
    { "chunkIndex": 0, "threadCount": 50, "digest": "..." },
    { "chunkIndex": 1, "threadCount": 50, "digest": "..." },
    { "chunkIndex": 2, "threadCount": 50, "digest": "..." },
    { "chunkIndex": 3, "threadCount": 50, "digest": "..." }
  ],
  "confirmToken": "shm_xxx",
  "expiresIn": 120
}
```

The single `confirmToken` archives all chunks, but the staging response shows per-chunk
digests so the human/agent can review each 50-thread group before confirming. This preserves
reviewability while eliminating multi-stage/confirm round-trips.

**Annotations:**
```json
{ "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false }
```

**`force: true` still required** when total > 50 (existing safeguard).

---

### P2-10: Expanded snippet / thread preview

**Change type:** Modify existing `superhuman_search`

**Input schema addition:**
```jsonc
{
  "snippetLength": {
    "type": "integer",
    "minimum": 50,
    "maximum": 500,
    "default": 150,
    "description": "Maximum length of the snippet in characters. Longer snippets improve classification but increase token usage."
  }
}
```

**Implementation:** If the backend returns full message previews, truncate client-side to
`snippetLength`. Strip HTML entities and zero-width characters before truncating.

---

## Existing Tool Hygiene (from audit gaps)

These are not new features — they're compliance fixes for the existing 40 tools.

### EH-1: Add `outputSchema` to all existing tools
Every tool should declare its response shape. Start with the 5 most-used tools in bulk
operations: `superhuman_search`, `superhuman_archive`, `superhuman_confirm`, `superhuman_read`,
`superhuman_accounts`. Then backfill the rest.

### EH-2: Add `annotations` to all existing tools
Classify every tool:
- **Read-only:** `search`, `read`, `inbox`, `starred`, `snoozed`, `labels`, `get_labels`,
  `attachments`, `accounts`, `snippets`, `audit_log`, `calendar_list`, `calendar_free_busy`
- **Destructive writes:** `archive`, `delete`, `confirm`
- **Non-destructive writes:** `draft`, `send`, `reply`, `reply_all`, `forward`, `mark_read`,
  `mark_unread`, `star`, `unstar`, `snooze`, `unsnooze`, `add_label`, `remove_label`,
  `switch_account`, `calendar_create`, `calendar_update`, `calendar_delete`

### EH-3: Verify `additionalProperties: false` on all input schemas
Audit every tool's `inputSchema`. Any missing `additionalProperties: false` must be added.

---

## Implementation Priority Order (revised)

| Order | Item | Type | Effort | Impact |
|---|---|---|---|---|
| 1 | **P0-2: Configurable `limit`** | Modify search | Trivial | 60% fewer pagination calls |
| 2 | **P0-1: `totalResults`** | Modify search output | Small | Eliminates recon phase |
| 3 | **EH-1/2/3: Schema hygiene** | All tools | Medium | MCP compliance baseline |
| 4 | **P0-3: `archive_by_query`** | New tool | Medium | Eliminates worst workflow loop |
| 5 | **P1-5: Richer metadata** | Modify search output | Small-Medium | 50% fewer ambiguous items |
| 6 | **P2-8: Domain-grouped anomalies** | Modify archive | Small | Cleaner batch review |
| 7 | **P2-9: Archive chunking** | Modify archive | Small | Fewer round-trips |
| 8 | **P1-4: Offset/pagination** | Modify search | Backend-dependent | Parallel pagination |
| 9 | **P2-10: Expanded snippets** | Modify search | Small | Better classification |
| 10 | **P2-7: countOnly** | Modify search | Small | Redundant if #2 done |
| — | ~~P1-6: Batch search~~ | ~~New tool~~ | — | **Deferred** — subagents solve this |

---

## Non-Tool Wishes (Claude Code / Platform Level)

Unchanged from wishlist — these are outside superhuman-cli scope:

- **A. Subagent file output mode** — structured "write your output here" parameter
- **B. Subagent shared context / reference document** — `referenceFiles` param on Agent tool
- **C. Cross-session state persistence** — key-value store surviving compaction/session breaks
