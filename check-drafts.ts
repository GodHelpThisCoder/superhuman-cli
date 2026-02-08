
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function checkDraftKeys() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "CFC not found" };
        const keys = Object.keys(cfc);
        const details = {};
        keys.forEach(k => {
          const draft = cfc[k].state?.draft;
          details[k] = {
            id: draft?.id,
            subject: draft?.subject,
            to: draft?.to?.map(r => r.email),
            bodyLen: draft?.body?.length
          };
        });
        return { keys, details };
      })()
    `,
    returnByValue: true
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

checkDraftKeys();
