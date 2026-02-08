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
        const disk = ga?.disk;
        const sync = disk?.sync;

        // Deep inspect sync
        const inspectObject = (obj, depth = 0) => {
          if (!obj || depth > 2) return null;
          const result = {
            type: typeof obj,
            constructor: obj?.constructor?.name,
            keys: Object.keys(obj).slice(0, 30),
            prototypeKeys: obj?.constructor?.prototype ?
              Object.getOwnPropertyNames(obj.constructor.prototype).slice(0, 30) : null,
          };
          return result;
        };

        // Check the sync object
        const syncInspect = inspectObject(sync);

        // Also check disk.user which might have write methods
        const user = disk?.user;
        const userInspect = inspectObject(user);

        // Check for _sync or internal properties
        const diskInternalKeys = disk ? Object.getOwnPropertyNames(disk).filter(k => k.startsWith("_")).slice(0, 20) : [];

        // Try to find the actual sync/write API
        // It might be in the prototype
        const diskProto = disk?.constructor?.prototype;
        const diskProtoMethods = diskProto ? Object.getOwnPropertyNames(diskProto).filter(k =>
          typeof diskProto[k] === "function"
        ).slice(0, 40) : [];

        return {
          syncInspect,
          userInspect,
          diskInternalKeys,
          diskProtoMethods
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

main();
