#!/usr/bin/env bun
/**
 * Gmail Service Exploration Script
 *
 * Enumerates ALL methods on the gmail service object (including prototype chain)
 * and checks for auth token access for direct Gmail API calls.
 *
 * Goal: Determine if we can send emails via Gmail API directly, bypassing
 * Superhuman's UI-based draft system.
 */

import { connectToSuperhuman } from "../superhuman-api";

interface GmailServiceInfo {
  found: boolean;
  error?: string;

  // All properties and methods
  ownProperties?: string[];
  prototypeProperties?: string[];
  allMethods?: Array<{ name: string; isAsync: boolean; argCount: number }>;

  // Auth-related
  hasAuthToken?: boolean;
  authTokenLocation?: string;
  accessToken?: string; // First 10 chars only

  // Service structure
  serviceKeys?: string[];
  diKeys?: string[];

  // Specific methods of interest
  methodsContainingSend?: string[];
  methodsContainingMessage?: string[];
  methodsContainingDraft?: string[];
  methodsContainingCreate?: string[];
  methodsContainingRaw?: string[];
}

async function exploreGmailService(conn: { Runtime: any }): Promise<GmailServiceInfo> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { found: false, error: "DI container not found" };
          }

          const gmail = di.get?.('gmail');
          if (!gmail) {
            return { found: false, error: "gmail service not found in DI" };
          }

          const info = { found: true };

          // Get all own properties
          info.ownProperties = Object.getOwnPropertyNames(gmail);

          // Get all prototype properties (recursively through prototype chain)
          const protoProps = new Set();
          let proto = Object.getPrototypeOf(gmail);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              protoProps.add(name);
            }
            proto = Object.getPrototypeOf(proto);
          }
          info.prototypeProperties = Array.from(protoProps);

          // Get all methods with details
          const allMethodNames = new Set([...info.ownProperties, ...info.prototypeProperties]);
          info.allMethods = [];

          for (const name of allMethodNames) {
            try {
              const prop = gmail[name];
              if (typeof prop === 'function') {
                info.allMethods.push({
                  name,
                  isAsync: prop.constructor.name === 'AsyncFunction' ||
                           prop.toString().includes('async') ||
                           prop[Symbol.toStringTag] === 'AsyncFunction',
                  argCount: prop.length
                });
              }
            } catch (e) {
              // Skip if we can't access the property
            }
          }

          // Sort methods alphabetically
          info.allMethods.sort((a, b) => a.name.localeCompare(b.name));

          // Filter for interesting methods
          const methodNames = info.allMethods.map(m => m.name.toLowerCase());

          info.methodsContainingSend = info.allMethods
            .filter(m => m.name.toLowerCase().includes('send'))
            .map(m => m.name);

          info.methodsContainingMessage = info.allMethods
            .filter(m => m.name.toLowerCase().includes('message'))
            .map(m => m.name);

          info.methodsContainingDraft = info.allMethods
            .filter(m => m.name.toLowerCase().includes('draft'))
            .map(m => m.name);

          info.methodsContainingCreate = info.allMethods
            .filter(m => m.name.toLowerCase().includes('create'))
            .map(m => m.name);

          info.methodsContainingRaw = info.allMethods
            .filter(m => m.name.toLowerCase().includes('raw'))
            .map(m => m.name);

          // Look for auth token
          info.hasAuthToken = false;

          // Check common locations for auth token
          const tokenLocations = [
            // Direct on gmail service
            () => gmail._accessToken,
            () => gmail.accessToken,
            () => gmail._token,
            () => gmail.token,
            () => gmail.authToken,
            () => gmail._authToken,
            () => gmail.auth?.accessToken,
            () => gmail._auth?.accessToken,

            // On oauth or credentials object
            () => gmail.oauth?.accessToken,
            () => gmail._oauth?.accessToken,
            () => gmail.credentials?.accessToken,
            () => gmail._credentials?.accessToken,

            // On http client
            () => gmail._http?.token,
            () => gmail._client?.token,
            () => gmail.http?.accessToken,

            // On DI container
            () => di.get?.('accessToken'),
            () => di.get?.('authToken'),
            () => di.get?.('oauth')?.accessToken,
            () => di.get?.('auth')?.accessToken,

            // On GoogleAccount
            () => ga?.accessToken,
            () => ga?._accessToken,
            () => ga?.auth?.accessToken,
            () => ga?.oauth?.accessToken,

            // On portal
            () => ga?.portal?.accessToken,
            () => ga?.portal?._accessToken,

            // In a request service
            () => di.get?.('request')?.accessToken,
            () => di.get?.('http')?.accessToken,
          ];

          for (let i = 0; i < tokenLocations.length; i++) {
            try {
              const token = tokenLocations[i]();
              if (token && typeof token === 'string' && token.length > 20) {
                info.hasAuthToken = true;
                info.authTokenLocation = \`Location index: \${i}\`;
                info.accessToken = token.substring(0, 10) + '...';
                break;
              }
            } catch (e) {}
          }

          // If not found, try to find it by exploring the gmail object deeply
          if (!info.hasAuthToken) {
            const findToken = (obj, path, depth = 0) => {
              if (depth > 3 || !obj || typeof obj !== 'object') return null;

              for (const key of Object.keys(obj)) {
                try {
                  const val = obj[key];
                  if (typeof val === 'string' && val.length > 50 &&
                      (key.toLowerCase().includes('token') ||
                       key.toLowerCase().includes('auth') ||
                       val.startsWith('ya29.') ||  // Google access token prefix
                       val.startsWith('Bearer '))) {
                    return { path: path + '.' + key, token: val };
                  }
                  if (typeof val === 'object' && val !== null) {
                    const found = findToken(val, path + '.' + key, depth + 1);
                    if (found) return found;
                  }
                } catch (e) {}
              }
              return null;
            };

            // Search in gmail object
            const gmailToken = findToken(gmail, 'gmail', 0);
            if (gmailToken) {
              info.hasAuthToken = true;
              info.authTokenLocation = gmailToken.path;
              info.accessToken = gmailToken.token.substring(0, 10) + '...';
            }

            // Search in DI container
            if (!info.hasAuthToken) {
              const diKeys = ['auth', 'oauth', 'credentials', 'http', 'request', 'api'];
              for (const key of diKeys) {
                try {
                  const service = di.get?.(key);
                  if (service) {
                    const found = findToken(service, 'di.' + key, 0);
                    if (found) {
                      info.hasAuthToken = true;
                      info.authTokenLocation = found.path;
                      info.accessToken = found.token.substring(0, 10) + '...';
                      break;
                    }
                  }
                } catch (e) {}
              }
            }
          }

          // Get DI container keys
          try {
            info.diKeys = [];
            if (di._bindings) {
              info.diKeys = Array.from(di._bindings.keys?.() || []);
            } else if (di._container) {
              info.diKeys = Object.keys(di._container);
            } else {
              // Try to enumerate di.get with common keys
              const commonKeys = [
                'gmail', 'msgraph', 'auth', 'oauth', 'http', 'request', 'api',
                'threads', 'messages', 'labels', 'drafts', 'send', 'compose',
                'account', 'user', 'session', 'token', 'credentials',
                'isMicrosoft', 'isGoogle', 'backend', 'portal'
              ];
              for (const key of commonKeys) {
                try {
                  if (di.get?.(key) !== undefined) {
                    info.diKeys.push(key);
                  }
                } catch (e) {}
              }
            }
          } catch (e) {
            info.diKeys = ['(could not enumerate)'];
          }

          // Get service keys (what's directly on gmail)
          info.serviceKeys = Object.keys(gmail).filter(k => !k.startsWith('_'));

          return info;
        } catch (e) {
          return { found: false, error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value as GmailServiceInfo;
}

async function exploreGmailMethodSignatures(conn: { Runtime: any }): Promise<Record<string, string>> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          const signatures = {};

          // Get all methods
          const allMethods = new Set();

          // Own properties
          for (const name of Object.getOwnPropertyNames(gmail)) {
            if (typeof gmail[name] === 'function') {
              allMethods.add(name);
            }
          }

          // Prototype chain
          let proto = Object.getPrototypeOf(gmail);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof gmail[name] === 'function') {
                allMethods.add(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          // Get function source for each method
          for (const name of allMethods) {
            try {
              const fn = gmail[name];
              const src = fn.toString();
              // Get first 500 chars of source
              signatures[name] = src.substring(0, 500);
            } catch (e) {
              signatures[name] = '(could not get source)';
            }
          }

          return signatures;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value as Record<string, string>;
}

async function tryFindAuthToken(conn: { Runtime: any }): Promise<{
  found: boolean;
  token?: string;
  location?: string;
  allLocationsChecked?: string[];
}> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const results = { found: false, allLocationsChecked: [] };

        const check = (location, getter) => {
          try {
            const val = getter();
            results.allLocationsChecked.push(location + ': ' + (val ? typeof val : 'undefined'));
            if (typeof val === 'string' && val.length > 20) {
              // Check if it looks like a Google access token
              if (val.startsWith('ya29.') || val.startsWith('Bearer ') || val.includes('.')) {
                results.found = true;
                results.token = val.substring(0, 20) + '...';
                results.location = location;
                return true;
              }
            }
          } catch (e) {
            results.allLocationsChecked.push(location + ': error - ' + e.message);
          }
          return false;
        };

        const ga = window.GoogleAccount;
        const di = ga?.di;
        const gmail = di?.get?.('gmail');
        const portal = ga?.portal;

        // Check all possible token locations
        const locations = [
          ['gmail._accessToken', () => gmail?._accessToken],
          ['gmail.accessToken', () => gmail?.accessToken],
          ['gmail._token', () => gmail?._token],
          ['gmail.token', () => gmail?.token],
          ['gmail._http?._token', () => gmail?._http?._token],
          ['gmail._http?.token', () => gmail?._http?.token],
          ['gmail._http?._accessToken', () => gmail?._http?._accessToken],
          ['gmail._http?.accessToken', () => gmail?._http?.accessToken],
          ['gmail._client?._token', () => gmail?._client?._token],
          ['gmail._client?.accessToken', () => gmail?._client?.accessToken],
          ['gmail.oauth?.access_token', () => gmail?.oauth?.access_token],
          ['gmail.oauth?.accessToken', () => gmail?.oauth?.accessToken],
          ['gmail._oauth?.access_token', () => gmail?._oauth?.access_token],

          ['di.get("auth")?.accessToken', () => di?.get?.('auth')?.accessToken],
          ['di.get("auth")?._accessToken', () => di?.get?.('auth')?._accessToken],
          ['di.get("oauth")?.accessToken', () => di?.get?.('oauth')?.accessToken],
          ['di.get("oauth")?.access_token', () => di?.get?.('oauth')?.access_token],
          ['di.get("http")?.accessToken', () => di?.get?.('http')?.accessToken],
          ['di.get("http")?._token', () => di?.get?.('http')?._token],

          ['ga?.accessToken', () => ga?.accessToken],
          ['ga?._accessToken', () => ga?._accessToken],
          ['ga?.auth?.accessToken', () => ga?.auth?.accessToken],
          ['ga?.oauth?.accessToken', () => ga?.oauth?.accessToken],
          ['ga?.oauth?.access_token', () => ga?.oauth?.access_token],

          ['portal?.accessToken', () => portal?.accessToken],
          ['portal?._accessToken', () => portal?._accessToken],
          ['portal?.auth?.accessToken', () => portal?.auth?.accessToken],

          // Check if there's a method to get the token
          ['gmail.getAccessToken?.()', () => gmail?.getAccessToken?.()],
          ['gmail.getToken?.()', () => gmail?.getToken?.()],
          ['di.get("auth")?.getAccessToken?.()', () => di?.get?.('auth')?.getAccessToken?.()],
          ['ga?.getAccessToken?.()', () => ga?.getAccessToken?.()],
        ];

        for (const [loc, getter] of locations) {
          if (check(loc, getter)) break;
        }

        // If not found, look for it in localStorage/sessionStorage
        if (!results.found) {
          try {
            for (const key of Object.keys(localStorage)) {
              if (key.includes('token') || key.includes('auth')) {
                const val = localStorage.getItem(key);
                if (val && val.length > 30) {
                  check('localStorage.' + key, () => val);
                  if (results.found) break;
                }
              }
            }
          } catch (e) {}
        }

        return results;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function testGmailApiCall(conn: { Runtime: any }): Promise<{
  success: boolean;
  error?: string;
  response?: any;
}> {
  const { Runtime } = conn;

  // Try to make a direct Gmail API call if we can find the auth mechanism
  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { success: false, error: "gmail not found" };

          // Check if there's a direct API method we can use
          const methodsToTry = [
            'listDrafts',
            'getDrafts',
            'listMessages',
            'getMessages',
            'getProfile',
            'getUserProfile',
            'list',
            'get',
          ];

          for (const method of methodsToTry) {
            if (typeof gmail[method] === 'function') {
              try {
                const result = await gmail[method]();
                return {
                  success: true,
                  method,
                  response: JSON.stringify(result).substring(0, 500)
                };
              } catch (e) {
                // Method exists but may need parameters
              }
            }
          }

          // Try getLabels which we know works
          if (typeof gmail.getLabels === 'function') {
            const labels = await gmail.getLabels();
            return {
              success: true,
              method: 'getLabels',
              labelCount: labels?.length,
              sampleLabel: labels?.[0],
            };
          }

          return {
            success: false,
            error: "No working read methods found",
            availableMethods: Object.getOwnPropertyNames(gmail).filter(
              k => typeof gmail[k] === 'function'
            ).slice(0, 20)
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return result.result.value;
}

async function exploreHttpClient(conn: { Runtime: any }): Promise<any> {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { error: "gmail not found" };

          const info = { httpClientInfo: {} };

          // Look for internal HTTP client
          const httpProps = ['_http', '_client', '_api', '_request', 'http', 'client', 'api', 'request'];

          for (const prop of httpProps) {
            const client = gmail[prop];
            if (client && typeof client === 'object') {
              info.httpClientInfo[prop] = {
                exists: true,
                type: client.constructor?.name || typeof client,
                keys: Object.keys(client).slice(0, 20),
                methods: Object.getOwnPropertyNames(client)
                  .filter(k => typeof client[k] === 'function')
                  .slice(0, 20),
              };

              // Check for base URL
              if (client.baseUrl) info.httpClientInfo[prop].baseUrl = client.baseUrl;
              if (client._baseUrl) info.httpClientInfo[prop]._baseUrl = client._baseUrl;
              if (client.url) info.httpClientInfo[prop].url = client.url;
            }
          }

          // Check for a fetch wrapper
          if (gmail._fetch || gmail.fetch) {
            info.hasFetch = true;
            info.fetchType = typeof (gmail._fetch || gmail.fetch);
          }

          // Check for headers
          if (gmail._headers || gmail.headers) {
            info.hasHeaders = true;
            try {
              info.headers = gmail._headers || gmail.headers;
            } catch (e) {}
          }

          return info;
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function main() {
  console.log("Gmail Service Exploration");
  console.log("=".repeat(60));
  console.log("");

  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    console.error("Make sure it's running with: /Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333");
    process.exit(1);
  }

  console.log("Connected to Superhuman\n");

  try {
    // 1. Explore gmail service
    console.log("1. Gmail Service Overview");
    console.log("-".repeat(40));
    const serviceInfo = await exploreGmailService(conn);

    if (!serviceInfo.found) {
      console.error("Gmail service not found:", serviceInfo.error);
      return;
    }

    console.log("Gmail service found!\n");

    console.log("Own properties:", serviceInfo.ownProperties?.length);
    console.log("Prototype properties:", serviceInfo.prototypeProperties?.length);
    console.log("Total methods:", serviceInfo.allMethods?.length);
    console.log("");

    // 2. Methods of interest
    console.log("2. Methods of Interest");
    console.log("-".repeat(40));

    console.log("\nMethods containing 'send':");
    for (const m of serviceInfo.methodsContainingSend || []) {
      console.log(`  - ${m}`);
    }

    console.log("\nMethods containing 'message':");
    for (const m of serviceInfo.methodsContainingMessage || []) {
      console.log(`  - ${m}`);
    }

    console.log("\nMethods containing 'draft':");
    for (const m of serviceInfo.methodsContainingDraft || []) {
      console.log(`  - ${m}`);
    }

    console.log("\nMethods containing 'create':");
    for (const m of serviceInfo.methodsContainingCreate || []) {
      console.log(`  - ${m}`);
    }

    console.log("\nMethods containing 'raw':");
    for (const m of serviceInfo.methodsContainingRaw || []) {
      console.log(`  - ${m}`);
    }
    console.log("");

    // 3. All methods
    console.log("3. All Gmail Service Methods");
    console.log("-".repeat(40));
    for (const method of serviceInfo.allMethods || []) {
      const asyncTag = method.isAsync ? '[async]' : '';
      console.log(`  ${method.name}(${method.argCount} args) ${asyncTag}`);
    }
    console.log("");

    // 4. Auth token search
    console.log("4. Auth Token Search");
    console.log("-".repeat(40));
    console.log("Has auth token:", serviceInfo.hasAuthToken);
    if (serviceInfo.hasAuthToken) {
      console.log("Token location:", serviceInfo.authTokenLocation);
      console.log("Token preview:", serviceInfo.accessToken);
    }
    console.log("");

    // 5. Detailed auth token search
    console.log("5. Detailed Auth Token Search");
    console.log("-".repeat(40));
    const tokenSearch = await tryFindAuthToken(conn);
    console.log("Found:", tokenSearch.found);
    if (tokenSearch.found) {
      console.log("Location:", tokenSearch.location);
      console.log("Token preview:", tokenSearch.token);
    }
    console.log("\nLocations checked:");
    for (const loc of (tokenSearch.allLocationsChecked || []).slice(0, 20)) {
      console.log(`  ${loc}`);
    }
    console.log("");

    // 6. HTTP client exploration
    console.log("6. HTTP Client Exploration");
    console.log("-".repeat(40));
    const httpInfo = await exploreHttpClient(conn);
    console.log(JSON.stringify(httpInfo, null, 2));
    console.log("");

    // 7. Test a Gmail API call
    console.log("7. Test Gmail API Call");
    console.log("-".repeat(40));
    const apiTest = await testGmailApiCall(conn);
    console.log(JSON.stringify(apiTest, null, 2));
    console.log("");

    // 8. Method signatures
    console.log("8. Method Signatures (first 500 chars each)");
    console.log("-".repeat(40));
    const signatures = await exploreGmailMethodSignatures(conn);

    // Only show interesting methods
    const interestingMethods = [
      'send', 'sendMessage', 'createDraft', 'updateDraft', 'deleteDraft',
      'changeLabelsPerThread', 'changeLabelsPerMessage', 'modifyMessage',
      'modifyThread', 'insertMessage', 'importMessage', 'batchModify'
    ];

    for (const method of interestingMethods) {
      if (signatures[method]) {
        console.log(`\n${method}:`);
        console.log(signatures[method]);
      }
    }
    console.log("");

    // 9. DI container keys
    console.log("9. DI Container Keys");
    console.log("-".repeat(40));
    for (const key of serviceInfo.diKeys || []) {
      console.log(`  - ${key}`);
    }

  } finally {
    await conn.client.close();
    console.log("\nDisconnected from Superhuman");
  }
}

main().catch(console.error);
