/**
 * MCP Tools Definition
 *
 * Defines the MCP tools that wrap Superhuman automation functions.
 * Uses the internal API approach via superhuman-api.ts.
 */

import { z } from "zod";
import {
  connectToSuperhuman,
  openCompose,
  addRecipient,
  setSubject,
  setBody,
  saveDraft,
  disconnect,
  getDraftState,
  type SuperhumanConnection,
} from "../superhuman-api";

const CDP_PORT = 9333;

/**
 * Zod schema for email draft parameters
 */
export const DraftSchema = z.object({
  to: z.string().describe("Recipient email address"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body content (plain text or HTML)"),
  cc: z.string().optional().describe("CC recipient email address (optional)"),
  bcc: z.string().optional().describe("BCC recipient email address (optional)"),
});

/**
 * Zod schema for email send parameters
 */
export const SendSchema = z.object({
  to: z.string().describe("Recipient email address"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body content (plain text or HTML)"),
  cc: z.string().optional().describe("CC recipient email address (optional)"),
  bcc: z.string().optional().describe("BCC recipient email address (optional)"),
});

/**
 * Zod schema for inbox search parameters
 */
export const SearchSchema = z.object({
  query: z.string().describe("Search query string"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of results to return (default: 10)"),
});

/**
 * Tool handler type for MCP tools
 */
export type ToolHandler<T> = (args: T) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

/**
 * Handler for superhuman_draft tool
 * Creates an email draft in Superhuman using internal API
 */
export const draftHandler: ToolHandler<z.infer<typeof DraftSchema>> = async (
  args
) => {
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const draftKey = await openCompose(conn);
    if (!draftKey) {
      throw new Error("Failed to open compose window");
    }

    await addRecipient(conn, args.to);

    if (args.subject) {
      await setSubject(conn, args.subject);
    }

    if (args.body) {
      const bodyHtml = args.body.includes("<")
        ? args.body
        : `<p>${args.body.replace(/\n/g, "</p><p>")}</p>`;
      await setBody(conn, bodyHtml);
    }

    await saveDraft(conn);

    const state = await getDraftState(conn);

    return {
      content: [
        {
          type: "text" as const,
          text: `Draft created successfully.\nTo: ${args.to}\nSubject: ${args.subject}\nDraft ID: ${state?.id || draftKey}`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to create draft: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  } finally {
    if (conn) {
      await disconnect(conn);
    }
  }
};

/**
 * Handler for superhuman_send tool
 * Sends an email via Superhuman using internal API
 */
export const sendHandler: ToolHandler<z.infer<typeof SendSchema>> = async (
  args
) => {
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const draftKey = await openCompose(conn);
    if (!draftKey) {
      throw new Error("Failed to open compose window");
    }

    await addRecipient(conn, args.to);

    if (args.subject) {
      await setSubject(conn, args.subject);
    }

    if (args.body) {
      const bodyHtml = args.body.includes("<")
        ? args.body
        : `<p>${args.body.replace(/\n/g, "</p><p>")}</p>`;
      await setBody(conn, bodyHtml);
    }

    // Send the email using internal API
    const { Runtime } = conn;
    const sendResult = await Runtime.evaluate({
      expression: `
        (() => {
          try {
            const cfc = window.ViewState?._composeFormController;
            if (!cfc) return { error: 'No controller' };
            const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
            if (!draftKey) return { error: 'No draft' };
            const ctrl = cfc[draftKey];
            if (!ctrl || typeof ctrl._sendDraft !== 'function') return { error: 'No send method' };
            ctrl._sendDraft();
            return { success: true };
          } catch (e) {
            return { error: e.message };
          }
        })()
      `,
      returnByValue: true,
    });

    const result = sendResult.result.value as { success?: boolean; error?: string };

    if (result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Email sent successfully.\nTo: ${args.to}\nSubject: ${args.subject}`,
          },
        ],
      };
    } else {
      throw new Error(result.error || "Failed to send");
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to send email: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  } finally {
    if (conn) {
      await disconnect(conn);
    }
  }
};

/**
 * Handler for superhuman_search tool
 * Searches the Superhuman inbox using internal API
 */
export const searchHandler: ToolHandler<z.infer<typeof SearchSchema>> = async (
  args
) => {
  let conn: SuperhumanConnection | null = null;

  try {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error("Could not connect to Superhuman. Make sure it's running with --remote-debugging-port=9333");
    }

    const { Runtime } = conn;
    const limit = args.limit ?? 10;

    const searchResult = await Runtime.evaluate({
      expression: `
        (async () => {
          try {
            const portal = window.GoogleAccount?.portal;
            if (!portal) {
              return { error: 'Superhuman portal not found' };
            }

            const query = ${JSON.stringify(args.query)};
            const limit = ${limit};

            const listResult = await portal.invoke("threadInternal", "listAsync", [
              "INBOX",
              { limit: limit, filters: [], query: query }
            ]);

            const threads = listResult?.threads || [];
            return {
              results: threads.slice(0, limit).map(t => {
                const json = t.json || {};
                const shData = t.superhumanData || {};

                let firstMessage = null;
                if (shData.messages && typeof shData.messages === 'object') {
                  const msgKeys = Object.keys(shData.messages);
                  if (msgKeys.length > 0) {
                    const msg = shData.messages[msgKeys[0]];
                    firstMessage = msg.draft || msg;
                  }
                } else if (json.messages && json.messages.length > 0) {
                  firstMessage = json.messages[0];
                }

                return {
                  id: json.id || '',
                  from: firstMessage?.from?.email || '',
                  subject: firstMessage?.subject || json.snippet || '',
                  snippet: firstMessage?.snippet || json.snippet || '',
                  date: firstMessage?.date || firstMessage?.clientCreatedAt || ''
                };
              })
            };
          } catch (err) {
            return { error: err.message };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const result = searchResult.result.value as {
      results?: Array<{ id: string; from: string; subject: string; snippet: string; date: string }>;
      error?: string;
    };

    if (result.error) {
      throw new Error(result.error);
    }

    const results = result.results || [];

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No results found for query: "${args.query}"`,
          },
        ],
      };
    }

    const resultsText = results
      .map(
        (r, i) =>
          `${i + 1}. From: ${r.from}\n   Subject: ${r.subject}\n   Date: ${r.date}\n   Snippet: ${r.snippet}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} result(s) for query: "${args.query}"\n\n${resultsText}`,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to search inbox: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  } finally {
    if (conn) {
      await disconnect(conn);
    }
  }
};

/**
 * All MCP tools for Superhuman automation
 */
export const mcpTools = [
  {
    name: "superhuman_draft",
    description: "Create an email draft in Superhuman",
    inputSchema: DraftSchema,
    handler: draftHandler,
  },
  {
    name: "superhuman_send",
    description: "Send an email via Superhuman",
    inputSchema: SendSchema,
    handler: sendHandler,
  },
  {
    name: "superhuman_search",
    description: "Search the Superhuman inbox",
    inputSchema: SearchSchema,
    handler: searchHandler,
  },
];
