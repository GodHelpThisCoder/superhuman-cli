import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) { console.log("No connection"); process.exit(1); }

  // First, let's see the current snippets state
  const currentState = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        return {
          snippets: settings?.get?.('snippets'),
          snippetsLastUsed: settings?.get?.('snippetsLastUsed')
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("=== Current State ===\n");
  console.log(JSON.stringify(currentState.result.value, null, 2));

  // Try to create a test snippet using settings.set
  // First, let's understand the structure by looking at how applySnippet works
  const snippetStructure = await conn.Runtime.evaluate({
    expression: `
      (() => {
        // Look for Snippet class or constructor
        const ga = window.GoogleAccount;

        // Check if there's a Snippet model
        const classes = [];
        for (const key of Object.keys(window)) {
          if (key.includes('Snippet') && typeof window[key] === 'function') {
            classes.push(key);
          }
        }

        // Check the compose controller for snippet structure hints
        const vs = window.ViewState;

        // Look for any cached snippet type definitions
        let snippetTypeHint = null;
        try {
          // Check if we can find snippet references in the code
          const settings = ga?.settings;
          const proto = Object.getPrototypeOf(settings);
          const setSource = settings.set?.toString?.();
          snippetTypeHint = setSource?.slice(0, 500);
        } catch (e) {}

        return {
          snippetClasses: classes,
          snippetTypeHint
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Snippet Structure Hints ===\n");
  console.log(JSON.stringify(snippetStructure.result.value, null, 2));

  // Now let's try to set a snippet and observe what happens
  console.log("\n=== Attempting to Create Test Snippet ===\n");

  // Generate a unique ID (similar to how Superhuman might generate IDs)
  const testSnippetId = 'test_' + Date.now().toString(36);

  const createResult = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        if (!settings) return { error: "no settings" };

        // Get current snippets
        const currentSnippets = settings.get('snippets') || {};

        // Create a test snippet - guessing the structure based on common patterns
        const testSnippet = {
          shortcut: 'test1',
          body: 'This is a test snippet body.',
          subject: 'Test Subject',
          to: [],
          cc: [],
          bcc: []
        };

        const testId = '${testSnippetId}';

        // Add to snippets
        const newSnippets = {
          ...currentSnippets,
          [testId]: testSnippet
        };

        try {
          // Try setting the snippets
          await settings.set('snippets', newSnippets);

          // Verify it was saved
          const afterSnippets = settings.get('snippets');

          return {
            success: true,
            testId,
            afterSnippets: JSON.stringify(afterSnippets)
          };
        } catch (e) {
          return {
            success: false,
            error: e.message,
            stack: e.stack?.slice(0, 500)
          };
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log(JSON.stringify(createResult.result.value, null, 2));

  // Check if the snippet was persisted
  await new Promise(r => setTimeout(r, 1000));

  const verifyResult = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const settings = ga?.settings;
        return {
          snippets: settings?.get?.('snippets'),
          cacheSnippets: settings?._cache?.snippets
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("\n=== Verification After 1 Second ===\n");
  console.log(JSON.stringify(verifyResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
