
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function debugCompose() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const rc = window.ViewState?.regionalCommands;
          const commands = [];
          for (const region of rc) {
            if (region?.commands) {
              for (const cmd of region.commands) {
                commands.push({ id: cmd.id, name: cmd.name });
              }
            }
          }
          
          // Search for COMPOSE
          const composeCmd = commands.find(c => c.id === 'COMPOSE' || c.id === 'NEW_MESSAGE');
          return { composeCmd, commands: commands.map(c => c.id) };
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

debugCompose();
