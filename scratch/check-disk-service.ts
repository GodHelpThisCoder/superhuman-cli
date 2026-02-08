import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const disk = di?.get("disk");

        if (!disk) return { error: "No disk service" };

        // Get all methods
        const methods = Object.keys(disk).filter(k => typeof disk[k] === "function");

        // Also check for userdata or backend service
        let userdata = null;
        let backend = null;

        try { userdata = di?.get("userdata"); } catch {}
        try { backend = di?.get("backend"); } catch {}

        return {
          diskMethods: methods.slice(0, 50),
          userdataMethods: userdata ? Object.keys(userdata).filter(k => typeof userdata[k] === "function").slice(0, 30) : null,
          backendMethods: backend ? Object.keys(backend).filter(k => typeof backend[k] === "function").slice(0, 30) : null,
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
