import CDP from "chrome-remote-interface";

async function main() {
  const targets = await CDP.List({ port: 9333 });

  // Get renderer page token
  const rendererTarget = targets.find(t =>
    t.url.includes("mail.superhuman.com") && !t.url.includes("background")
  );

  // Get background page token
  const bgTarget = targets.find(t => t.url.includes("background_page"));

  console.log("Comparing tokens from renderer vs background page...\n");

  if (rendererTarget) {
    const client = await CDP({ target: rendererTarget.id, port: 9333 });
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          const ga = window.GoogleAccount;
          const authData = ga?.credential?._authData;
          return {
            idToken: authData?.idToken?.substring(0, 80) + "...",
            accessToken: authData?.accessToken?.substring(0, 80) + "...",
            expires: authData?.expires,
            tokenType: authData?.token_type,
          };
        })()
      `,
      returnByValue: true,
    });
    console.log("RENDERER PAGE:");
    console.log(JSON.stringify(result.result.value, null, 2));
    await client.close();
  }

  if (bgTarget) {
    const client = await CDP({ target: bgTarget.id, port: 9333 });
    const result = await client.Runtime.evaluate({
      expression: `
        (() => {
          // Background page might have different structure
          // Check for any auth-related globals
          const findings = {};

          // Check if there's a global auth store
          if (typeof self !== "undefined") {
            const authKeys = Object.keys(self).filter(k =>
              k.toLowerCase().includes("auth") ||
              k.toLowerCase().includes("token") ||
              k.toLowerCase().includes("credential")
            );
            findings.authKeys = authKeys.slice(0, 20);
          }

          // Check chrome.storage for tokens
          findings.hasStorage = typeof chrome !== "undefined" && !!chrome.storage;

          return findings;
        })()
      `,
      returnByValue: true,
    });
    console.log("\nBACKGROUND PAGE:");
    console.log(JSON.stringify(result.result.value, null, 2));
    await client.close();
  }
}

main().catch(console.error);
