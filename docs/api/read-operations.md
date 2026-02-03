# Superhuman Read Operations API Documentation

> Auto-generated on 2026-01-31

## Overview

This document captures the internal API patterns used by Superhuman for read operations.
Superhuman uses an RPC-style API via `window.GoogleAccount.portal.invoke()`.

## Portal Architecture

### Portal Object Structure

The portal is a message-passing bridge between the UI (foreground) and background workers.

```javascript
const portal = window.GoogleAccount.portal;

// Key properties
portal.email       // Current user email
portal.sessionId   // Session identifier
portal.invoke()    // RPC method for API calls
```

### Communication Pattern

Superhuman uses a multi-process architecture:
- **Foreground**: UI rendering, user interaction
- **Background**: Data sync, API calls, caching

The portal routes `invoke()` calls to the appropriate background service.

## Portal Invocation Pattern

```javascript
// General pattern
const result = await window.GoogleAccount.portal.invoke(
  serviceName,   // e.g., "threadInternal"
  methodName,    // e.g., "listAsync"
  [...args]      // method arguments as array
);
```

## Read Operation APIs

### 1. List Threads (threadInternal.listAsync)

Lists threads from a specific folder/label with optional search query.

```javascript
const response = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "listAsync",
  ["INBOX", {
    limit: 10,
    filters: [],
    query: ""
  }]
);
```

**Parameters:**
- `labelId` (string): Folder/label to list from
- `options` (object):
  - `limit` (number): Maximum threads to return
  - `filters` (array): Filter criteria
  - `query` (string): Gmail search syntax

**Supported Labels:**
| Label | Description |
|-------|-------------|
| `INBOX` | Main inbox |
| `SENT` | Sent mail |
| `DRAFT` | Drafts |
| `TRASH` | Trash |
| `SPAM` | Spam |
| `STARRED` | Starred messages |
| `IMPORTANT` | Important messages |
| `UNREAD` | Unread messages |

**Response Structure:**
```typescript
interface ListResponse {
  query: string;
  startAt: number;
  threads: Array<{
    json: {
      id: string;
      subject: string;
      messages: Message[];
      labelIds: string[];
    };
    superhumanData: object;
    needsRender: boolean;
    listIds: string[];
    size: number;
  }>;
  nextPageToken?: string;
  modifiers: object;
  queryStartAt: number;
  queryFinishAt: number;
  noMoreOnDisk: boolean;
  finishAt: number;
}
```

### 2. Search Threads

Uses the same `listAsync` method with a query parameter.

```javascript
// Search for unread emails
const response = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "listAsync",
  ["INBOX", {
    limit: 10,
    filters: [],
    query: "is:unread"
  }]
);

// Search by sender
const response = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "listAsync",
  ["INBOX", {
    limit: 10,
    filters: [],
    query: "from:example@gmail.com"
  }]
);
```

**Query Syntax:** Uses Gmail search syntax:
- `is:unread` - Unread messages
- `is:starred` - Starred messages
- `from:email` - From specific sender
- `to:email` - To specific recipient
- `subject:text` - Subject contains text
- `has:attachment` - Has attachments
- `after:YYYY/MM/DD` - After date
- `before:YYYY/MM/DD` - Before date

### 3. Get Thread Details (threadInternal.getAsync)

Fetches full thread details by ID.

```javascript
const thread = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "getAsync",
  [threadId]
);
```

**Response:** Returns the full thread object with all messages.

### 4. Fetch Thread (threadInternal.fetchAsync)

Similar to getAsync, fetches and returns thread data.

```javascript
const thread = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "fetchAsync",
  [threadId]
);
```

### 5. Get Message Body (messageInternal.getBodyAsync)

Fetches the HTML body of a specific message.

```javascript
const body = await window.GoogleAccount.portal.invoke(
  "messageInternal",
  "getBodyAsync",
  [messageId]
);
```

**Response:** Returns the HTML body content as a string.

## In-Memory Data Access

For performance, Superhuman caches thread data in memory. This is often faster than making API calls.

### Thread Cache (identityMap)

```javascript
// Access the identity map
const identityMap = window.GoogleAccount.threads.identityMap;

// Get a cached thread
const thread = identityMap.get(threadId);
const model = thread._threadModel;

// Thread properties
const subject = model.subject;
const messages = model.messages;
const labelIds = model.labelIds;
const messageCount = messages.length;
```

### Message Properties

```javascript
const message = model.messages[0];

// Basic properties
message.id           // Message ID
message.threadId     // Parent thread ID
message.subject      // Subject line
message.snippet      // Preview text
message.date         // Date (or message.rawJson.date)

// Sender/recipients
message.from.email   // Sender email
message.from.name    // Sender name (may be function)
message.to           // Array of recipients
message.cc           // Array of CC recipients
message.bcc          // Array of BCC recipients

// Body (may need to be fetched separately)
message.body         // Plain text body
message.rawJson.body // Alternative location
```

### View State Access

```javascript
// Current thread list
const sortedList = window.ViewState.threadListState._list._sortedList.sorted;

// Current open thread ID
const currentThreadId = window.ViewState.tree.get().threadPane?.threadId;
```

## Other Discovered Services

### modifierInternal

```javascript
// Get uncompleted modifiers (pending actions)
const modifiers = await window.GoogleAccount.portal.invoke(
  "modifierInternal",
  "getAllUncompletedModifiersAsync",
  []
);
```

### accountBackground

```javascript
// Ping the background service
const pong = await window.GoogleAccount.portal.invoke(
  "accountBackground",
  "ping",
  []
);
```

## Summary

| Operation | Service | Method | Parameters |
|-----------|---------|--------|------------|
| List threads | threadInternal | listAsync | [label, {limit, filters, query}] |
| Search threads | threadInternal | listAsync | [label, {limit, filters, query}] |
| Get thread | threadInternal | getAsync | [threadId] |
| Fetch thread | threadInternal | fetchAsync | [threadId] |
| Get message body | messageInternal | getBodyAsync | [messageId] |
| Get modifiers | modifierInternal | getAllUncompletedModifiersAsync | [] |

## Key Findings

1. **RPC-style API**: Superhuman uses `portal.invoke(service, method, args)` for all API calls.

2. **Background routing**: API calls are routed to background services; no direct HTTP calls are visible.

3. **Multiple access patterns**:
   - API calls via `portal.invoke()` for fresh data
   - Cache via `identityMap` for fast access
   - View state via `ViewState` for current UI data

4. **Gmail search syntax**: The `query` parameter in `listAsync` uses Gmail's search syntax.

5. **Message body lazy loading**: Message bodies may not be immediately available in cache and may need to be fetched via `getBodyAsync`.

## Authentication

Authentication is handled via the Electron app's session:
- `portal.email` - Current user's email
- `portal.sessionId` - Session identifier
- No explicit token management needed when using portal API
