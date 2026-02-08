
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function findIsabelle() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const identityMap = ga?.threads?.identityMap;
          if (!identityMap) return { error: "No identityMap" };

          const results = [];
          
          // Helper to check for Isabelle
          const check = (r, modelId, subject) => {
            if (!r) return;
            const name = r.name || r.displayName || r.fullName || '';
            const email = r.email || '';
            if (name.toLowerCase().includes('isabelle') || email.toLowerCase().includes('isabelle')) {
              results.push({ name, email, threadId: modelId, subject });
            }
          };

          // Iterate over identityMap
          // If it's a Map
          if (typeof identityMap.forEach === 'function') {
            identityMap.forEach((thread, id) => {
              const model = thread?._threadModel;
              if (!model) return;
              const messages = model.messages || [];
              messages.forEach(msg => {
                check(msg.from, model.id, model.subject);
                (msg.to || []).forEach(r => check(r, model.id, model.subject));
                (msg.cc || []).forEach(r => check(r, model.id, model.subject));
              });
            });
          } else {
            // If it's a plain object
            for (const key in identityMap) {
              const thread = identityMap[key];
              const model = thread?._threadModel;
              if (!model) continue;
              const messages = model.messages || [];
              for (const msg of messages) {
                check(msg.from, model.id, model.subject);
                (msg.to || []).forEach(r => check(r, model.id, model.subject));
                (msg.cc || []).forEach(r => check(r, model.id, model.subject));
              }
            }
          }
          return results;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

findIsabelle().catch(console.error);
