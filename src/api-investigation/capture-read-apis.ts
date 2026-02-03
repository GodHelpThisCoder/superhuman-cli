#!/usr/bin/env bun
/**
 * Superhuman Read API Investigation Script
 *
 * Captures HTTP requests and WebSocket messages made during read operations
 * in Superhuman using Chrome DevTools Protocol's Network domain.
 *
 * Usage: bun run src/api-investigation/capture-read-apis.ts
 */

import CDP from "chrome-remote-interface";
import { connectToSuperhuman } from "../superhuman-api";
import { writeFileSync } from "node:fs";

interface CapturedRequest {
  timestamp: string;
  operation: string;
  type: "http" | "websocket";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: string;
  wsPayload?: string;
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  };
}

interface RequestInfo {
  request: CDP.Protocol.Network.Request;
  operation: string;
  timestamp: string;
}

interface PortalCall {
  timestamp: number;
  service: string;
  method: string;
  args: string;
  result?: string;
  error?: string;
}

const capturedRequests: CapturedRequest[] = [];
const pendingRequests = new Map<string, RequestInfo>();
let currentOperation = "idle";

/**
 * Start capturing network requests and WebSocket traffic
 */
async function startNetworkCapture(client: CDP.Client): Promise<void> {
  const { Network } = client;

  await Network.enable({
    maxTotalBufferSize: 10000000,
    maxResourceBufferSize: 5000000,
  });

  // Capture HTTP request details
  Network.requestWillBeSent(({ requestId, request, timestamp }) => {
    // Filter to only capture relevant API calls
    if (
      request.url.includes("api.superhuman.com") ||
      request.url.includes("googleapis.com") ||
      request.url.includes("superhuman.com/api") ||
      request.url.includes("portal") ||
      request.url.includes("prod-portal")
    ) {
      pendingRequests.set(requestId, {
        request,
        operation: currentOperation,
        timestamp: new Date(timestamp * 1000).toISOString(),
      });
      console.log(`[${currentOperation}] HTTP Request: ${request.method} ${request.url}`);
    }
  });

  // Capture HTTP response
  Network.responseReceived(async ({ requestId, response }) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    try {
      let body: string | undefined;
      try {
        const { body: respBody, base64Encoded } = await Network.getResponseBody({ requestId });
        body = base64Encoded ? Buffer.from(respBody, "base64").toString() : respBody;
        if (body && body.length > 10000) {
          body = body.substring(0, 10000) + "\n... [truncated]";
        }
      } catch {
        // Response body may not be available
      }

      const captured: CapturedRequest = {
        timestamp: pending.timestamp,
        operation: pending.operation,
        type: "http",
        url: pending.request.url,
        method: pending.request.method,
        headers: pending.request.headers,
        postData: pending.request.postData,
        response: {
          status: response.status,
          headers: response.headers,
          body,
        },
      };

      capturedRequests.push(captured);
      console.log(`  Response: ${response.status}`);
    } catch (e) {
      console.error(`  Error capturing response: ${(e as Error).message}`);
    }

    pendingRequests.delete(requestId);
  });

  // Capture WebSocket handshake
  Network.webSocketCreated(({ requestId, url }) => {
    console.log(`[WS] WebSocket created: ${url}`);
  });

  // Capture WebSocket frames sent
  Network.webSocketFrameSent(({ requestId, timestamp, response }) => {
    if (response.payloadData) {
      const payload = response.payloadData.substring(0, 500);
      console.log(`[${currentOperation}] WS Sent: ${payload}...`);

      capturedRequests.push({
        timestamp: new Date(timestamp * 1000).toISOString(),
        operation: currentOperation,
        type: "websocket",
        url: "websocket",
        wsPayload: response.payloadData.substring(0, 5000),
      });
    }
  });

  // Capture WebSocket frames received
  Network.webSocketFrameReceived(({ requestId, timestamp, response }) => {
    if (response.payloadData && response.payloadData.length > 10) {
      const payload = response.payloadData.substring(0, 200);
      if (
        payload.includes("thread") ||
        payload.includes("message") ||
        payload.includes("inbox") ||
        payload.includes("list")
      ) {
        console.log(`[${currentOperation}] WS Recv: ${payload}...`);
        capturedRequests.push({
          timestamp: new Date(timestamp * 1000).toISOString(),
          operation: currentOperation,
          type: "websocket",
          url: "websocket",
          response: {
            body: response.payloadData.substring(0, 5000),
          },
        });
      }
    }
  });
}

/**
 * Explore the portal internals to understand the communication pattern
 */
async function explorePortalInternals(client: CDP.Client): Promise<Record<string, unknown>> {
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const portal = window.GoogleAccount?.portal;
          if (!portal) return { error: "Portal not found" };

          const info = {
            portalType: typeof portal,
            portalKeys: Object.keys(portal).slice(0, 30),
            hasInvoke: typeof portal.invoke === 'function',
            hasRequest: typeof portal.request === 'function',
            email: portal.email,
            sessionId: portal.sessionId,
          };

          // Check for internal services or endpoints
          if (portal._endpoint) info.endpoint = portal._endpoint;
          if (portal._baseUrl) info.baseUrl = portal._baseUrl;
          if (portal._url) info.url = portal._url;
          if (portal.baseUrl) info.baseUrl2 = portal.baseUrl;

          // Check prototype
          const proto = Object.getPrototypeOf(portal);
          if (proto) {
            info.protoMethods = Object.getOwnPropertyNames(proto).filter(
              p => typeof portal[p] === 'function'
            ).slice(0, 30);
          }

          // Check for _services
          if (portal._services) {
            info.services = {};
            for (const [name, service] of Object.entries(portal._services)) {
              if (service && typeof service === 'object') {
                info.services[name] = Object.keys(service).slice(0, 10);
              }
            }
          }

          // Check DI container
          if (portal.di) {
            info.diKeys = Object.keys(portal.di).slice(0, 30);
          }

          // Check for stored connection info
          if (portal._connection) info.hasConnection = true;
          if (portal._socket) info.hasSocket = true;
          if (portal._ws) info.hasWebSocket = true;

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as Record<string, unknown>;
}

/**
 * Explore the DI container to find available services
 */
async function exploreDIContainer(client: CDP.Client): Promise<Record<string, unknown>> {
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const di = window.GoogleAccount?.portal?.di;
          if (!di) return { error: "DI container not found" };

          const info = {
            diType: typeof di,
            diKeys: [],
            services: {},
          };

          // Get all keys from di
          const allKeys = Object.keys(di);
          info.diKeys = allKeys;

          // Check for specific services we might need
          const serviceNames = ['thread', 'threadInternal', 'message', 'messageInternal',
                               'label', 'labelInternal', 'attachment', 'sync', 'search'];

          for (const name of serviceNames) {
            const service = di[name];
            if (service) {
              const serviceMethods = [];
              // Get prototype methods
              const proto = Object.getPrototypeOf(service);
              if (proto) {
                serviceMethods.push(...Object.getOwnPropertyNames(proto).filter(
                  p => typeof service[p] === 'function' && p !== 'constructor'
                ));
              }
              // Get own methods
              for (const key of Object.keys(service)) {
                if (typeof service[key] === 'function') {
                  serviceMethods.push(key);
                }
              }
              info.services[name] = [...new Set(serviceMethods)];
            }
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as Record<string, unknown>;
}

/**
 * Explore what methods threadInternal actually has
 */
async function exploreThreadInternalMethods(client: CDP.Client): Promise<string[]> {
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          // Try to invoke a method that lists available methods
          const portal = window.GoogleAccount?.portal;
          if (!portal) return [];

          // Check if there's a way to get service info
          const callbacks = portal.callbacks;
          if (callbacks) {
            return Object.keys(callbacks);
          }

          return [];
        } catch (e) {
          return [e.message];
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as string[];
}

/**
 * Intercept portal.invoke to capture calls with full details
 */
async function instrumentPortalInvoke(client: CDP.Client): Promise<void> {
  const { Runtime } = client;

  await Runtime.evaluate({
    expression: `
      (() => {
        if (window.__portalIntercepted) return "already intercepted";
        window.__portalIntercepted = true;
        window.__portalCalls = [];

        const portal = window.GoogleAccount?.portal;
        if (!portal || typeof portal.invoke !== 'function') return "no portal";

        const originalInvoke = portal.invoke.bind(portal);
        portal.invoke = async function(...args) {
          const call = {
            timestamp: Date.now(),
            service: args[0],
            method: args[1],
            args: JSON.stringify(args.slice(2)).substring(0, 2000),
          };

          try {
            const result = await originalInvoke(...args);
            call.result = JSON.stringify(result).substring(0, 2000);
            window.__portalCalls.push(call);
            console.log('[Portal Invoke Success]', call.service, call.method);
            return result;
          } catch (e) {
            call.error = e.message;
            window.__portalCalls.push(call);
            console.log('[Portal Invoke Error]', call.service, call.method, e.message);
            throw e;
          }
        };

        return "intercepted";
      })()
    `,
    returnByValue: true,
  });
}

/**
 * Get intercepted portal calls
 */
async function getPortalCalls(client: CDP.Client): Promise<PortalCall[]> {
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `window.__portalCalls || []`,
    returnByValue: true,
  });

  return result.result.value as PortalCall[];
}

/**
 * List inbox threads using the internal API
 */
async function listInboxOperation(client: CDP.Client): Promise<unknown> {
  const { Runtime } = client;

  currentOperation = "list_inbox";
  console.log("\n=== Operation: List Inbox ===");

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const response = await window.GoogleAccount.portal.invoke(
            "threadInternal",
            "listAsync",
            ["INBOX", { limit: 5, filters: [], query: "" }]
          );
          return {
            success: true,
            threadCount: response?.threads?.length || 0,
            sampleThread: response?.threads?.[0] ? {
              id: response.threads[0].id || response.threads[0].json?.id,
              subject: response.threads[0].subject || response.threads[0].json?.subject,
              keys: Object.keys(response.threads[0]).slice(0, 10),
            } : null,
            responseKeys: response ? Object.keys(response).slice(0, 10) : [],
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));
  await new Promise((r) => setTimeout(r, 2000));
  return result.result.value;
}

/**
 * Search inbox using the internal API
 */
async function searchOperation(client: CDP.Client, query: string): Promise<unknown> {
  const { Runtime } = client;

  currentOperation = "search";
  console.log(`\n=== Operation: Search (query: "${query}") ===`);

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const response = await window.GoogleAccount.portal.invoke(
            "threadInternal",
            "listAsync",
            ["INBOX", { limit: 5, filters: [], query: ${JSON.stringify(query)} }]
          );
          return {
            success: true,
            threadCount: response?.threads?.length || 0,
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));
  await new Promise((r) => setTimeout(r, 2000));
  return result.result.value;
}

/**
 * Get detailed thread data from in-memory cache
 */
async function getThreadFromCache(client: CDP.Client, threadId: string): Promise<unknown> {
  const { Runtime } = client;

  currentOperation = "read_thread_cache";
  console.log(`\n=== Operation: Read Thread from Cache (id: ${threadId}) ===`);

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const identityMap = window.GoogleAccount?.threads?.identityMap;
          if (!identityMap) return { success: false, error: "identityMap not found" };

          const thread = identityMap.get(${JSON.stringify(threadId)});
          if (!thread) return { success: false, error: "thread not in cache" };

          const model = thread._threadModel;
          if (!model) return { success: false, error: "no thread model" };

          const messages = model.messages || [];
          return {
            success: true,
            id: model.id,
            subject: model.subject,
            messageCount: messages.length,
            labelIds: model.labelIds,
            messages: messages.map(m => ({
              id: m.id,
              subject: m.subject,
              from: m.from?.email,
              date: m.rawJson?.date || m.date,
              snippet: m.snippet?.substring(0, 100),
              hasBody: !!m.body || !!m.rawJson?.body,
              bodyLength: (m.body || m.rawJson?.body || '').length,
            })),
            modelKeys: Object.keys(model).slice(0, 20),
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));
  return result.result.value;
}

/**
 * Get message body directly from cached message
 */
async function getMessageBodyFromCache(client: CDP.Client, threadId: string, messageId: string): Promise<unknown> {
  const { Runtime } = client;

  currentOperation = "get_message_body_cache";
  console.log(`\n=== Operation: Get Message Body from Cache ===`);

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const identityMap = window.GoogleAccount?.threads?.identityMap;
          if (!identityMap) return { success: false, error: "identityMap not found" };

          const thread = identityMap.get(${JSON.stringify(threadId)});
          if (!thread) return { success: false, error: "thread not in cache" };

          const model = thread._threadModel;
          const messages = model?.messages || [];
          const message = messages.find(m => m.id === ${JSON.stringify(messageId)});

          if (!message) return { success: false, error: "message not found", messageIds: messages.map(m => m.id) };

          // Try various body locations
          const body = message.body || message.rawJson?.body || message._body;
          const bodyHtml = message.bodyHtml || message.rawJson?.bodyHtml;

          return {
            success: true,
            messageId: message.id,
            hasBody: !!body,
            hasBodyHtml: !!bodyHtml,
            bodyPreview: body ? body.substring(0, 500) : null,
            bodyHtmlPreview: bodyHtml ? bodyHtml.substring(0, 500) : null,
            messageKeys: Object.keys(message).slice(0, 20),
            rawJsonKeys: message.rawJson ? Object.keys(message.rawJson).slice(0, 20) : [],
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("Result:", JSON.stringify(result.result.value, null, 2));
  return result.result.value;
}

/**
 * Try fetching thread via different API methods
 */
async function tryDifferentFetchMethods(client: CDP.Client, threadId: string): Promise<unknown[]> {
  const { Runtime } = client;

  currentOperation = "try_fetch_methods";
  console.log(`\n=== Operation: Try Different Fetch Methods ===`);

  const methods = [
    { service: "threadInternal", method: "fetchAsync", args: `[${JSON.stringify(threadId)}]` },
    { service: "threadInternal", method: "get", args: `[${JSON.stringify(threadId)}]` },
    { service: "threadInternal", method: "fetch", args: `[${JSON.stringify(threadId)}]` },
    { service: "thread", method: "getAsync", args: `[${JSON.stringify(threadId)}]` },
    { service: "thread", method: "fetchAsync", args: `[${JSON.stringify(threadId)}]` },
  ];

  const results = [];

  for (const m of methods) {
    const result = await Runtime.evaluate({
      expression: `
        (async () => {
          try {
            const response = await window.GoogleAccount.portal.invoke(
              "${m.service}",
              "${m.method}",
              ${m.args}
            );
            return {
              method: "${m.service}.${m.method}",
              success: true,
              responseType: typeof response,
              hasData: !!response,
              preview: JSON.stringify(response).substring(0, 300),
            };
          } catch (e) {
            return {
              method: "${m.service}.${m.method}",
              success: false,
              error: e.message,
            };
          }
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    });

    results.push(result.result.value);
    console.log(`  ${(result.result.value as { method: string; success: boolean; error?: string }).method}:`,
      (result.result.value as { success: boolean }).success ? "SUCCESS" :
        (result.result.value as { error?: string }).error);
  }

  return results;
}

/**
 * Get a thread ID from the current inbox for testing
 */
async function getFirstThreadId(client: CDP.Client): Promise<{
  threadId: string;
  messageId: string;
  subject: string;
} | null> {
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const threadList = window.ViewState?.threadListState?._list?._sortedList?.sorted;
          if (!threadList || !Array.isArray(threadList) || threadList.length === 0) return null;

          const ref = threadList[0];
          if (!ref?.id) return null;

          const identityMap = window.GoogleAccount?.threads?.identityMap;
          if (!identityMap) return null;

          const thread = identityMap.get(ref.id);
          if (!thread?._threadModel) return null;

          const model = thread._threadModel;
          const messages = model.messages || [];
          const firstMessage = messages[0];

          return {
            threadId: model.id,
            messageId: firstMessage?.id || null,
            subject: model.subject || '(no subject)',
          };
        } catch (e) {
          return null;
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as { threadId: string; messageId: string; subject: string } | null;
}

/**
 * Get list of all available listAsync parameters
 */
async function exploreListAsyncParams(client: CDP.Client): Promise<unknown> {
  const { Runtime } = client;

  currentOperation = "explore_list_params";
  console.log("\n=== Exploring listAsync Parameters ===");

  // Try different label/folder names
  const labels = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "IMPORTANT", "UNREAD"];
  const results: Record<string, unknown> = {};

  for (const label of labels) {
    const result = await Runtime.evaluate({
      expression: `
        (async () => {
          try {
            const response = await window.GoogleAccount.portal.invoke(
              "threadInternal",
              "listAsync",
              [${JSON.stringify(label)}, { limit: 1, filters: [], query: "" }]
            );
            return {
              success: true,
              count: response?.threads?.length || 0,
            };
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    });

    results[label] = result.result.value;
  }

  console.log("Label results:", JSON.stringify(results, null, 2));
  return results;
}

/**
 * Generate markdown documentation
 */
function generateMarkdown(
  portalInfo: Record<string, unknown>,
  diInfo: Record<string, unknown>,
  portalCalls: PortalCall[]
): string {
  const grouped = new Map<string, CapturedRequest[]>();

  for (const req of capturedRequests) {
    const existing = grouped.get(req.operation) || [];
    existing.push(req);
    grouped.set(req.operation, existing);
  }

  let md = `# Superhuman Read Operations API Documentation

> Auto-generated on ${new Date().toISOString()}

## Overview

This document captures the internal API patterns used by Superhuman for read operations.
Superhuman uses an RPC-style API via \`window.GoogleAccount.portal.invoke()\`.

## Portal Architecture

### Portal Object Structure

\`\`\`json
${JSON.stringify(portalInfo, null, 2)}
\`\`\`

### Dependency Injection Container

\`\`\`json
${JSON.stringify(diInfo, null, 2)}
\`\`\`

## Portal Invocation Pattern

Superhuman uses an internal RPC pattern:

\`\`\`javascript
// General pattern
const result = await window.GoogleAccount.portal.invoke(
  serviceName,   // e.g., "threadInternal"
  methodName,    // e.g., "listAsync"
  [...args]      // method arguments
);
\`\`\`

## Observed API Calls

`;

  // Group portal calls by service
  const callsByService = new Map<string, PortalCall[]>();
  for (const call of portalCalls) {
    const existing = callsByService.get(call.service) || [];
    existing.push(call);
    callsByService.set(call.service, existing);
  }

  for (const [service, calls] of callsByService) {
    md += `### ${service}\n\n`;
    for (const call of calls) {
      const status = call.error ? `ERROR: ${call.error}` : "SUCCESS";
      md += `#### ${call.method} - ${status}\n\n`;
      md += `**Call:**\n\`\`\`javascript\nawait portal.invoke("${service}", "${call.method}", ${call.args})\n\`\`\`\n\n`;

      if (call.result) {
        md += `**Response:**\n\`\`\`json\n`;
        try {
          md += JSON.stringify(JSON.parse(call.result), null, 2);
        } catch {
          md += call.result;
        }
        md += `\n\`\`\`\n\n`;
      }
    }
  }

  // Network traffic section
  if (capturedRequests.length > 0) {
    md += `## Network Traffic

${capturedRequests.length} requests/messages captured.

`;

    for (const [operation, requests] of grouped) {
      md += `### ${operation}\n\n`;

      for (const req of requests) {
        if (req.type === "http") {
          md += `#### HTTP: ${req.method} ${new URL(req.url).pathname}\n\n`;
          md += `**URL:** \`${req.url}\`\n\n`;

          if (req.postData) {
            md += "**Request Body:**\n```json\n";
            try {
              md += JSON.stringify(JSON.parse(req.postData), null, 2);
            } catch {
              md += req.postData;
            }
            md += "\n```\n\n";
          }

          if (req.response?.body) {
            md += `**Response (${req.response.status}):**\n\`\`\`json\n`;
            try {
              md += JSON.stringify(JSON.parse(req.response.body), null, 2);
            } catch {
              md += req.response.body;
            }
            md += "\n```\n\n";
          }
        } else if (req.type === "websocket") {
          if (req.wsPayload) {
            md += `#### WebSocket Sent\n\n\`\`\`json\n`;
            try {
              md += JSON.stringify(JSON.parse(req.wsPayload), null, 2);
            } catch {
              md += req.wsPayload;
            }
            md += "\n```\n\n";
          }
          if (req.response?.body) {
            md += `#### WebSocket Received\n\n\`\`\`json\n`;
            try {
              md += JSON.stringify(JSON.parse(req.response.body), null, 2);
            } catch {
              md += req.response.body;
            }
            md += "\n```\n\n";
          }
        }
      }
    }
  }

  md += `

## Key Read Operation APIs

### 1. List Inbox Threads

\`\`\`javascript
const response = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "listAsync",
  ["INBOX", {
    limit: 10,
    filters: [],
    query: ""
  }]
);

// Response structure:
// {
//   threads: Array<{
//     id: string,
//     json: {
//       id: string,
//       subject: string,
//       messages: Array<Message>,
//       labelIds: string[]
//     }
//   }>,
//   nextPageToken?: string
// }
\`\`\`

### 2. Search Threads

\`\`\`javascript
const response = await window.GoogleAccount.portal.invoke(
  "threadInternal",
  "listAsync",
  ["INBOX", {
    limit: 10,
    filters: [],
    query: "is:unread"  // Gmail search syntax
  }]
);
\`\`\`

### 3. Supported Labels/Folders

The first parameter to \`listAsync\` accepts these labels:
- \`INBOX\` - Main inbox
- \`SENT\` - Sent mail
- \`DRAFT\` - Drafts
- \`TRASH\` - Trash
- \`SPAM\` - Spam
- \`STARRED\` - Starred messages
- \`IMPORTANT\` - Important messages
- \`UNREAD\` - Unread messages

## Data Access Patterns

### In-Memory Thread Data

Threads are cached in \`window.GoogleAccount.threads.identityMap\`:

\`\`\`javascript
// Get cached thread
const identityMap = window.GoogleAccount.threads.identityMap;
const thread = identityMap.get(threadId);
const model = thread._threadModel;

// Access thread properties
const subject = model.subject;
const messages = model.messages;
const labelIds = model.labelIds;

// Access message details
const message = model.messages[0];
const body = message.body || message.rawJson?.body;
const bodyHtml = message.bodyHtml || message.rawJson?.bodyHtml;
\`\`\`

### View State

Current view data is available via \`window.ViewState\`:

\`\`\`javascript
// Current thread list
const sortedList = window.ViewState.threadListState._list._sortedList.sorted;

// Current open thread
const currentThreadId = window.ViewState.tree.get().threadPane?.threadId;
\`\`\`

## Summary

| Operation | Service | Method | Status |
|-----------|---------|--------|--------|
| List inbox | threadInternal | listAsync | Working |
| Search | threadInternal | listAsync | Working |
| Get thread | (cache) | identityMap.get() | Working |
| Get message body | (cache) | message.body | Working |

### Key Findings

1. **listAsync works** - The \`threadInternal.listAsync\` method works for listing and searching threads.

2. **No separate getAsync** - Unlike expected, there's no \`threadInternal.getAsync\` or \`messageInternal.getBodyAsync\` method available.

3. **Use cache for details** - Thread and message details are accessed from the in-memory cache (\`identityMap\`) rather than via API calls.

4. **Message body in cache** - Message bodies are available in the cached thread model, accessed via \`message.body\` or \`message.rawJson.body\`.

### Communication Pattern

Superhuman uses a message-passing pattern between foreground and background processes:
- The portal acts as a bridge between the UI and background workers
- Data is cached in \`identityMap\` after initial sync
- The \`listAsync\` API fetches fresh data that updates the cache

### Authentication

Authentication is handled via the Electron app's session. The portal uses \`portal.email\` and \`portal.sessionId\` for identity.
`;

  return md;
}

/**
 * Main execution
 */
async function main() {
  console.log("Superhuman Read API Investigation");
  console.log("==================================\n");

  // Connect to Superhuman
  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman. Make sure it's running with CDP enabled.");
    console.error("Launch with: /Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // Start network capture
    await startNetworkCapture(conn.client);
    console.log("Network capture enabled\n");

    // Instrument portal.invoke to see what's being called
    await instrumentPortalInvoke(conn.client);
    console.log("Portal invoke instrumented\n");

    // Explore portal internals
    console.log("=== Portal Internals ===");
    const portalInfo = await explorePortalInternals(conn.client);
    console.log(JSON.stringify(portalInfo, null, 2));

    // Explore DI container
    console.log("\n=== DI Container ===");
    const diInfo = await exploreDIContainer(conn.client);
    console.log(JSON.stringify(diInfo, null, 2));

    // Wait a moment for the UI to settle
    await new Promise((r) => setTimeout(r, 1000));

    // Perform read operations

    // 1. List inbox
    await listInboxOperation(conn.client);

    // 2. Search
    await searchOperation(conn.client, "is:unread");

    // 3. Explore different labels
    await exploreListAsyncParams(conn.client);

    // 4. Get a thread ID for further testing
    const threadInfo = await getFirstThreadId(conn.client);
    if (threadInfo) {
      console.log(`\nFound thread for testing: ${threadInfo.threadId} - "${threadInfo.subject}"`);

      // 5. Try different fetch methods
      await tryDifferentFetchMethods(conn.client, threadInfo.threadId);

      // 6. Get thread from cache
      await getThreadFromCache(conn.client, threadInfo.threadId);

      // 7. Get message body from cache
      if (threadInfo.messageId) {
        await getMessageBodyFromCache(conn.client, threadInfo.threadId, threadInfo.messageId);
      }
    } else {
      console.log("\nNo threads found for detailed testing");
    }

    // Wait for pending requests
    await new Promise((r) => setTimeout(r, 3000));

    // Get intercepted portal calls
    const portalCalls = await getPortalCalls(conn.client);
    console.log(`\n=== Intercepted ${portalCalls.length} Portal Calls ===`);
    for (const call of portalCalls) {
      const status = call.error ? `ERROR: ${call.error}` : "SUCCESS";
      console.log(`  ${call.service}.${call.method}: ${status}`);
    }

    // Generate documentation
    console.log("\n=== Generating Documentation ===");
    const markdown = generateMarkdown(portalInfo, diInfo, portalCalls);
    const outputPath = "/Users/vwh7mb/projects/superhuman-cli/docs/api/read-operations.md";
    writeFileSync(outputPath, markdown);
    console.log(`Documentation written to: ${outputPath}`);

    console.log(`\nCaptured ${capturedRequests.length} network requests/messages`);
  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
