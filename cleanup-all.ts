
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function cleanupAllDrafts() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { count: 0 };
          const keys = Object.keys(cfc).filter(k => k.startsWith('draft'));
          let count = 0;
          for (const key of keys) {
            const ctrl = cfc[key];
            if (typeof ctrl.discard === 'function') {
              await ctrl.discard();
              count++;
            } else if (typeof ctrl._discardDraftAsync === 'function') {
              await ctrl._discardDraftAsync();
              count++;
            }
          }
          return { count };
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

cleanupAllDrafts();
