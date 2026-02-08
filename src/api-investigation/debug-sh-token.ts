/**
 * Debug Superhuman backend token extraction
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

const CDP_PORT = 9333;

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  // Explore the backend credential structure
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const backend = ga?.backend;
          const credential = ga?.credential;

          if (!backend) {
            return { error: "No backend found" };
          }

          // Get all properties of backend._credential
          const backendCred = backend._credential;
          const credInfo = {
            type: typeof backendCred,
            isString: typeof backendCred === 'string',
            keys: backendCred ? Object.keys(backendCred) : null,
            hasToken: backendCred?.token ? 'yes' : 'no',
            hasAccessToken: backendCred?.accessToken ? 'yes' : 'no',
            has_token: backendCred?._token ? 'yes' : 'no',
            has_authData: backendCred?._authData ? 'yes' : 'no',
            hasAuthData: backendCred?.authData ? 'yes' : 'no',
          };

          // If it's a string, it might be the token directly
          if (typeof backendCred === 'string') {
            credInfo.tokenPreview = backendCred.substring(0, 50) + '...';
          }

          // Check credential object too
          const mainCredInfo = {
            type: typeof credential,
            keys: credential ? Object.keys(credential).slice(0, 20) : null,
            has_authData: credential?._authData ? 'yes' : 'no',
          };

          // Check _authData for token
          if (credential?._authData) {
            mainCredInfo._authDataKeys = Object.keys(credential._authData);
            mainCredInfo.accessTokenPreview = credential._authData.accessToken?.substring(0, 50) + '...';
          }

          return {
            backendCredential: credInfo,
            mainCredential: mainCredInfo,
            accountEmail: ga?.emailAddress,
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("Backend credential structure:", JSON.stringify(result.result.value, null, 2));

  // Try to get the actual token that's used for API calls
  const tokenResult = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const ga = window.GoogleAccount;
          const credential = ga?.credential;

          // The OAuth token from credential._authData is what we need
          if (credential?._authData?.accessToken) {
            return {
              tokenType: 'oauth',
              token: credential._authData.accessToken,
              expires: credential._authData.expires,
            };
          }

          // Try backend credential as fallback
          const backend = ga?.backend;
          if (typeof backend?._credential === 'string') {
            return {
              tokenType: 'backend_string',
              token: backend._credential,
            };
          }

          return { error: 'Could not find token' };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  console.log("\nExtracted token info:", JSON.stringify({
    ...tokenResult.result.value,
    token: tokenResult.result.value.token ? tokenResult.result.value.token.substring(0, 50) + '...' : null,
  }, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
