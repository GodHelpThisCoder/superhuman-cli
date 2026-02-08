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

        // Check disk service
        const disk = ga?.disk;
        const diskMethods = disk ? Object.keys(disk).filter(k => typeof disk[k] === "function") : [];
        const diskProps = disk ? Object.keys(disk).filter(k => typeof disk[k] !== "function" && !k.startsWith("_")) : [];

        // Check backend service
        const backend = ga?.backend;
        const backendMethods = backend ? Object.keys(backend).filter(k => typeof backend[k] === "function") : [];

        // Check for any write/sync related methods
        const allMethods = [
          ...diskMethods.map(m => "disk." + m),
          ...backendMethods.map(m => "backend." + m),
        ];

        const writeMethods = allMethods.filter(m =>
          m.toLowerCase().includes("write") ||
          m.toLowerCase().includes("save") ||
          m.toLowerCase().includes("sync") ||
          m.toLowerCase().includes("put") ||
          m.toLowerCase().includes("post") ||
          m.toLowerCase().includes("create")
        );

        // Check disk._api or disk.api
        let diskApi = null;
        if (disk?._api) {
          diskApi = Object.keys(disk._api).filter(k => typeof disk._api[k] === "function").slice(0, 30);
        } else if (disk?.api) {
          diskApi = Object.keys(disk.api).filter(k => typeof disk.api[k] === "function").slice(0, 30);
        }

        return {
          diskMethods: diskMethods.slice(0, 40),
          diskProps: diskProps.slice(0, 20),
          backendMethods: backendMethods.slice(0, 40),
          writeMethods,
          diskApi
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
