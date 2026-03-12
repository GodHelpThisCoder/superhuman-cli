# superhuman-cli — Agent Instructions

## Project Identity
superhuman-cli (v0.14.1) is a 36-tool MCP server + CLI for programmatic control of Superhuman email via Chrome DevTools Protocol. Fork of edwinhu/superhuman-cli with safety hardening.

## Key Facts
- **Runtime:** Bun 1.3.5 (not Node.js)
- **CDP port:** 9333 (default)
- **Accounts:** shawnmsorrell@gmail.com (primary), cv.ssorrell@gmail.com (secondary)
- **Entry points:** `src/cli.ts` (CLI), `src/index.ts` (MCP server)

## Commands
- `bun test` — Run all tests (230 tests, 27 files)
- `bun test src/__tests__/<file>` — Run specific test file
- `bunx tsc --noEmit` — Type-check without emitting
- `bun run src/cli.ts` — CLI entry point
- `bun run src/index.ts --mcp` — MCP server mode
- `bun run src/index.ts --mcp --verbose` — MCP server with debug logging
- `SUPERHUMAN_LOG_LEVEL=debug bun run src/index.ts --mcp` — Same via env var

## Testing
- **Unit tests:** Mock CDP responses, run without live Superhuman (`src/__tests__/*.test.ts`)
- **Integration tests:** 9 tests require live Superhuman instance with CDP on port 9333
- Run single test: `bun test src/__tests__/compose.test.ts`

## Do / Don't
- **Do** use `response.text()` + `JSON.parse()` for authFetch responses (not `.json()`)
- **Do** mark destructive MCP tools with `annotations.destructiveHint: true`
- **Do** include `dryRun` option in all mutating tool schemas
- **Don't** set `userdata.getThreads` limit > 50 (backend returns HTTP 400)
- **Don't** use Node.js APIs when Bun equivalents exist (see Bun section below)

## Adding a New MCP Tool
1. Define Zod schema in tool registration (`src/mcp/server.ts`)
2. Implement handler function
3. Add `annotations` (destructiveHint, readOnlyHint)
4. Add `dryRun` support if the tool mutates state
5. Write tests in `src/__tests__/`
6. Update superhuman-cli/README.md tool table

## Safety Features
- **Kill switch:** `src/kill-switch.ts` — blocks all mutations when active
- **Audit log:** `src/audit.ts` — JSONL log of all mutations with rotation, includes `durationMs` timing
- **Two-phase commit:** `src/mcp/confirmation.ts` — `shm_` tokens for destructive ops
- **Dry-run:** All mutating tools accept `dryRun: true` for preview

## Observability
- **Structured logger:** `src/logger.ts` — `createLogger("module")` returns `{ debug, info, warn, error }`
- **Output:** All logging goes to stderr (stdout reserved for MCP protocol)
- **File logging:** `~/.config/superhuman-cli/superhuman.log` (enabled via `initFileLogging()`, 5MB rotation)
- **`--verbose` flag:** Sets log level to debug; also `SUPERHUMAN_LOG_LEVEL=debug` env var
- **CDP network capture:** At debug level, logs all CDP network requests/responses via `cdp-network` logger
- **Duration tracking:** Every mutating tool records `durationMs` in audit log entries

---

## Bun Runtime Defaults

Default to using Bun instead of Node.js. Minimum version: Bun 1.3.5.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Chrome DevTools Protocol (CDP)

When connecting to Superhuman via CDP, **always monitor BOTH the background page AND the main UI page** to capture all API calls:

```typescript
import CDP from "chrome-remote-interface";

// 1. List all available pages
const targets = await CDP.List({ port: 9333 });

// 2. Find the background page (where API calls happen)
const backgroundPage = targets.find(t => 
  t.url.includes("background_page.html")
);

// 3. Find the main UI page (optional, for UI interactions)
const mainPage = targets.find(t => 
  t.url.includes("mail.superhuman.com") && t.type === "page"
);

// 4. Connect to background page for network monitoring
const bgClient = await CDP({ port: 9333, target: backgroundPage.id });
const { Network } = bgClient;
await Network.enable();

// Network events will now capture backend API calls
```

**Why both pages matter:**
- **Background page** (`background_page.html`): All API calls to Superhuman backend (`userdata.*`, `messages.*`, etc.)
- **Main UI page** (`mail.superhuman.com`): User interactions, UI state changes

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
