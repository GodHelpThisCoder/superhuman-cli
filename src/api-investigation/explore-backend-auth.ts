/**
 * Explore Superhuman Backend Authentication
 *
 * Investigate what tokens/credentials are used and if we can get them via HTTP.
 */

import { connectToSuperhuman } from "../superhuman-api";

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman();
  const { Runtime } = conn;

  // Explore the backend credential structure
  console.log("\n=== Backend Credential Structure ===");
  const backendCred = await Runtime.evaluate({
    expression: `
      (() => {
        const backend = window.GoogleAccount?.backend;
        if (!backend) return { error: "No backend" };

        const cred = backend._credential;
        if (!cred) return { error: "No credential" };

        // Get all enumerable properties
        const props = {};
        for (const key in cred) {
          const val = cred[key];
          if (typeof val === 'function') {
            props[key] = '[function]';
          } else if (typeof val === 'object' && val !== null) {
            props[key] = Object.keys(val).slice(0, 10);
          } else {
            props[key] = val;
          }
        }

        // Also check prototype
        const proto = Object.getPrototypeOf(cred);
        const protoMethods = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');

        return {
          props,
          protoMethods,
          constructorName: cred.constructor?.name,
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(backendCred.result.value, null, 2));

  // Check if there's a way to refresh or get tokens via backend
  console.log("\n=== Backend Methods ===");
  const backendMethods = await Runtime.evaluate({
    expression: `
      (() => {
        const backend = window.GoogleAccount?.backend;
        if (!backend) return { error: "No backend" };

        const methods = [];
        const proto = Object.getPrototypeOf(backend);
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (typeof backend[name] === 'function' && name !== 'constructor') {
            methods.push(name);
          }
        }

        // Also check own properties
        for (const key of Object.keys(backend)) {
          if (typeof backend[key] === 'function') {
            methods.push(key);
          }
        }

        return { methods: [...new Set(methods)].sort() };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(backendMethods.result.value, null, 2));

  // Check the portal object (used for listSnoozed)
  console.log("\n=== Portal Methods ===");
  const portalMethods = await Runtime.evaluate({
    expression: `
      (() => {
        const portal = window.GoogleAccount?.portal;
        if (!portal) return { error: "No portal" };

        const methods = [];
        const proto = Object.getPrototypeOf(portal);
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (typeof portal[name] === 'function' && name !== 'constructor') {
            methods.push(name);
          }
        }

        return { methods: methods.sort() };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(portalMethods.result.value, null, 2));

  // Check OAuth credential structure
  console.log("\n=== OAuth Credential Structure ===");
  const oauthCred = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const cred = ga?.credential;
        if (!cred) return { error: "No credential" };

        const authData = cred._authData;
        return {
          hasAuthData: !!authData,
          authDataKeys: authData ? Object.keys(authData) : [],
          accessTokenLength: authData?.accessToken?.length,
          expires: authData?.expires,
          expiresIn: authData?.expires ? (authData.expires - Date.now()) / 1000 / 60 + ' minutes' : null,
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(oauthCred.result.value, null, 2));

  // Check what headers the backend uses
  console.log("\n=== Backend Request Headers ===");
  const headers = await Runtime.evaluate({
    expression: `
      (() => {
        const backend = window.GoogleAccount?.backend;
        if (!backend) return { error: "No backend" };

        // Try to find how requests are made
        const fetchOriginal = backend._fetch || backend.fetch;
        const credHeaders = backend._credential?._headers?.();

        return {
          hasFetch: typeof fetchOriginal === 'function',
          credHeaders: credHeaders,
          baseUrl: backend._baseUrl || backend.baseUrl,
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(headers.result.value, null, 2));

  // Check if there's a session/cookie-based auth
  console.log("\n=== Session Info ===");
  const session = await Runtime.evaluate({
    expression: `
      (() => {
        return {
          cookies: document.cookie.split(';').map(c => c.trim().split('=')[0]),
          localStorage: Object.keys(localStorage).filter(k =>
            k.includes('token') || k.includes('auth') || k.includes('session') || k.includes('credential')
          ),
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(session.result.value, null, 2));

  // Check the actual token format used in requests
  console.log("\n=== Token Format in Requests ===");
  const tokenFormat = await Runtime.evaluate({
    expression: `
      (() => {
        const backend = window.GoogleAccount?.backend;
        const cred = backend?._credential;

        // Try to get an authorization header
        if (typeof cred?.getAuthorizationHeader === 'function') {
          try {
            const header = cred.getAuthorizationHeader();
            return {
              authHeader: header?.substring(0, 50) + '...',
              headerType: header?.split(' ')[0],
            };
          } catch (e) {
            return { error: e.message };
          }
        }

        // Check if it's just a Bearer token
        if (cred?.token) {
          return {
            tokenType: 'Bearer',
            tokenLength: cred.token.length,
            tokenPrefix: cred.token.substring(0, 20) + '...',
          };
        }

        return { noTokenMethod: true };
      })()
    `,
    returnByValue: true,
  });
  console.log(JSON.stringify(tokenFormat.result.value, null, 2));

  console.log("\n=== Done ===");
}

main().catch(console.error);
