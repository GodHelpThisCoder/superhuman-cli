#!/usr/bin/env bun
/**
 * Contacts API Discovery Script
 *
 * Explores Superhuman's internal APIs to discover contact/autocomplete services.
 * Searches for people API, contacts API, and autocomplete functionality.
 *
 * Usage: bun run src/api-investigation/contacts-discovery.ts
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

interface ContactsDiscoveryResult {
  timestamp: string;
  accountType: "google" | "microsoft" | "unknown";

  // DI Services
  diServicesFound: string[];

  // Potential contact services
  contactServices: Array<{
    name: string;
    type: string;
    methods: string[];
    properties: string[];
  }>;

  // Gmail service contact-related methods
  gmailContactMethods: string[];

  // Msgraph contact-related methods
  msgraphContactMethods: string[];

  // Portal contact methods
  portalContactMethods: string[];

  // ViewState autocomplete
  viewStateAutocomplete: any;

  // Compose form autocomplete
  composeAutocomplete: any;

  errors: string[];
}

async function discoverContactsApis(): Promise<void> {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, true);

  if (!conn) {
    console.error("Could not connect to Superhuman");
    process.exit(1);
  }

  const { Runtime } = conn;
  const errors: string[] = [];

  try {
    console.log("\n=== Contacts API Discovery ===\n");

    // Step 1: Enumerate ALL DI services
    console.log("Step 1: Enumerating ALL DI services...");
    const diResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;

          if (!di) {
            return { error: "DI container not found" };
          }

          const isMicrosoft = di.get?.('isMicrosoft');

          // Try to enumerate ALL DI bindings
          let allServices = [];

          // Check for _bindings (common DI pattern)
          if (di._bindings && typeof di._bindings.keys === 'function') {
            allServices = Array.from(di._bindings.keys());
          } else if (di._container) {
            allServices = Object.keys(di._container);
          } else if (di._services) {
            allServices = Object.keys(di._services);
          } else {
            // Brute force: try all common service names
            const possibleNames = [
              // Core
              'gmail', 'msgraph', 'gcal', 'isMicrosoft', 'isGoogle',
              'backend', 'portal', 'threads', 'messages',

              // Contacts/People/Autocomplete
              'contacts', 'people', 'autocomplete', 'addressbook',
              'recipients', 'suggestions', 'peopleApi', 'contactsApi',
              'peopleService', 'contactsService', 'autocompleteService',
              'addressBook', 'recipientSuggestions', 'emailAutocomplete',
              'contactSearch', 'peopleSearch', 'directory', 'gal',
              'globalAddressList', 'ldap', 'exchange', 'outlook',

              // Auth/User
              'auth', 'oauth', 'user', 'profile', 'account',
              'session', 'credentials', 'token',

              // Other
              'http', 'request', 'api', 'fetch', 'network',
              'cache', 'storage', 'db', 'sync',
              'labels', 'folders', 'drafts', 'send',
              'compose', 'search', 'filter', 'settings',
              'calendar', 'events', 'tasks', 'reminders',
              'snooze', 'archive', 'trash', 'spam',
              'star', 'important', 'unread', 'read',
            ];

            for (const name of possibleNames) {
              try {
                const service = di.get?.(name);
                if (service !== undefined && service !== null) {
                  allServices.push(name);
                }
              } catch (e) {}
            }
          }

          return {
            isMicrosoft,
            services: allServices,
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const diData = diResult.result.value as {
      isMicrosoft?: boolean;
      services?: string[];
      error?: string;
    };

    if (diData.error) {
      errors.push(`DI: ${diData.error}`);
      console.error(diData.error);
    } else {
      console.log(`Account type: ${diData.isMicrosoft ? "Microsoft" : "Google"}`);
      console.log(`Found ${diData.services?.length || 0} DI services:`);
      for (const svc of diData.services || []) {
        console.log(`  - ${svc}`);
      }
    }

    // Step 2: Search for contact-related services specifically
    console.log("\nStep 2: Searching for contact-related services...");
    const contactServicesResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const results = [];

          if (!di) return { error: "DI not found" };

          // Contact-related service names to check
          const contactNames = [
            'contacts', 'people', 'autocomplete', 'addressbook',
            'recipients', 'suggestions', 'peopleApi', 'contactsApi',
            'peopleService', 'contactsService', 'autocompleteService',
            'addressBook', 'recipientSuggestions', 'emailAutocomplete',
            'contactSearch', 'peopleSearch', 'directory', 'gal',
            'globalAddressList', 'exchange', 'outlook', 'ldap',
            'team', 'members', 'users', 'colleagues', 'organization',
          ];

          for (const name of contactNames) {
            try {
              const service = di.get?.(name);
              if (service && typeof service === 'object') {
                const methods = Object.keys(service)
                  .filter(k => typeof service[k] === 'function')
                  .slice(0, 30);
                const properties = Object.keys(service)
                  .filter(k => typeof service[k] !== 'function')
                  .slice(0, 20);

                results.push({
                  name,
                  type: service.constructor?.name || typeof service,
                  methods,
                  properties,
                });
              }
            } catch (e) {}
          }

          return { services: results };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const contactServices = contactServicesResult.result.value as {
      services?: Array<{ name: string; type: string; methods: string[]; properties: string[] }>;
      error?: string;
    };

    if (contactServices.error) {
      console.error("Contact services search error:", contactServices.error);
    } else if (contactServices.services && contactServices.services.length > 0) {
      console.log(`Found ${contactServices.services.length} contact-related services:`);
      for (const svc of contactServices.services) {
        console.log(`\n  ${svc.name} (${svc.type}):`);
        console.log(`    Methods: ${svc.methods.join(', ')}`);
        console.log(`    Properties: ${svc.properties.join(', ')}`);
      }
    } else {
      console.log("No dedicated contact services found in DI container.");
    }

    // Step 3: Check gmail service for contact-related methods
    console.log("\nStep 3: Checking gmail service for contact methods...");
    const gmailResult = await Runtime.evaluate({
      expression: `
        (() => {
          const gmail = window.GoogleAccount?.di?.get?.('gmail');
          if (!gmail) return { methods: [], error: "gmail service not found" };

          // Get ALL methods, then filter for contact-related
          const allMethods = [];

          // Own properties
          for (const name of Object.getOwnPropertyNames(gmail)) {
            if (typeof gmail[name] === 'function') {
              allMethods.push(name);
            }
          }

          // Prototype chain
          let proto = Object.getPrototypeOf(gmail);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof gmail[name] === 'function' && !allMethods.includes(name)) {
                allMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          const contactKeywords = ['contact', 'people', 'autocomplete', 'suggest',
                                   'recipient', 'address', 'directory', 'search',
                                   'resolve', 'lookup', 'find'];

          const contactMethods = allMethods.filter(m =>
            contactKeywords.some(kw => m.toLowerCase().includes(kw))
          );

          return {
            methods: contactMethods,
            allMethodCount: allMethods.length,
            // Also return any method with 'get' that might return contacts
            getMethods: allMethods.filter(m => m.startsWith('get')),
          };
        })()
      `,
      returnByValue: true,
    });

    const gmailData = gmailResult.result.value as {
      methods: string[];
      allMethodCount?: number;
      getMethods?: string[];
      error?: string;
    };

    console.log(`Gmail service has ${gmailData.allMethodCount || 0} total methods`);
    console.log(`Contact-related methods: ${gmailData.methods?.join(", ") || "none"}`);
    console.log(`Get methods: ${gmailData.getMethods?.slice(0, 10).join(", ") || "none"}...`);

    // Step 4: Check msgraph service for contact methods
    console.log("\nStep 4: Checking msgraph service for contact methods...");
    const msgraphResult = await Runtime.evaluate({
      expression: `
        (() => {
          const msgraph = window.GoogleAccount?.di?.get?.('msgraph');
          if (!msgraph) return { methods: [], error: "msgraph service not found" };

          const allMethods = [];

          for (const name of Object.getOwnPropertyNames(msgraph)) {
            if (typeof msgraph[name] === 'function') {
              allMethods.push(name);
            }
          }

          let proto = Object.getPrototypeOf(msgraph);
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof msgraph[name] === 'function' && !allMethods.includes(name)) {
                allMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }

          const contactKeywords = ['contact', 'people', 'user', 'autocomplete',
                                   'suggest', 'recipient', 'address', 'directory',
                                   'search', 'resolve', 'lookup', 'find', 'person'];

          const contactMethods = allMethods.filter(m =>
            contactKeywords.some(kw => m.toLowerCase().includes(kw))
          );

          return {
            methods: contactMethods,
            allMethodCount: allMethods.length,
            allMethods: allMethods.slice(0, 50),
          };
        })()
      `,
      returnByValue: true,
    });

    const msgraphData = msgraphResult.result.value as {
      methods: string[];
      allMethodCount?: number;
      allMethods?: string[];
      error?: string;
    };

    if (msgraphData.error) {
      console.log(`msgraph service not found (expected for Google account)`);
    } else {
      console.log(`Msgraph service has ${msgraphData.allMethodCount || 0} total methods`);
      console.log(`Contact-related methods: ${msgraphData.methods?.join(", ") || "none"}`);
      console.log(`All methods: ${msgraphData.allMethods?.join(", ") || "none"}`);
    }

    // Step 5: Check portal for contact-related RPC methods
    console.log("\nStep 5: Checking portal for contact RPC methods...");
    const portalResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const portal = window.GoogleAccount?.portal;
          if (!portal) return { error: "portal not found" };

          // Check portal methods
          const portalMethods = [];
          for (const name of Object.getOwnPropertyNames(portal)) {
            if (typeof portal[name] === 'function') {
              portalMethods.push(name);
            }
          }

          // Try to list portal services (if there's an invoke method)
          let services = [];
          if (portal.invoke) {
            // Common portal service names to check
            const serviceNames = ['contacts', 'people', 'autocomplete',
                                  'directory', 'search', 'users', 'recipients'];
            for (const svc of serviceNames) {
              try {
                // Try to call a listAsync or similar method
                const result = await portal.invoke(svc, 'listAsync', []);
                if (result) {
                  services.push({ name: svc, hasData: true });
                }
              } catch (e) {
                // Service might exist but method doesn't
                services.push({ name: svc, error: e.message?.substring(0, 100) });
              }
            }
          }

          return { portalMethods, services };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const portalData = portalResult.result.value as {
      portalMethods?: string[];
      services?: Array<{ name: string; hasData?: boolean; error?: string }>;
      error?: string;
    };

    if (portalData.error) {
      console.log("Portal not found");
    } else {
      console.log(`Portal methods: ${portalData.portalMethods?.join(", ") || "none"}`);
      console.log("Portal services tested:");
      for (const svc of portalData.services || []) {
        console.log(`  ${svc.name}: ${svc.hasData ? 'HAS DATA' : svc.error}`);
      }
    }

    // Step 6: Check ViewState for autocomplete functionality
    console.log("\nStep 6: Checking ViewState for autocomplete...");
    const viewStateResult = await Runtime.evaluate({
      expression: `
        (() => {
          const vs = window.ViewState;
          if (!vs) return { error: "ViewState not found" };

          const keys = Object.keys(vs);
          const autocompleteKeys = keys.filter(k =>
            k.toLowerCase().includes('autocomplete') ||
            k.toLowerCase().includes('suggest') ||
            k.toLowerCase().includes('contact') ||
            k.toLowerCase().includes('recipient')
          );

          // Also check tree state
          let treeAutocomplete = null;
          try {
            const tree = vs.tree?.get?.() || vs.tree;
            if (tree) {
              const treeKeys = Object.keys(tree);
              const autocompleteTreeKeys = treeKeys.filter(k =>
                k.toLowerCase().includes('autocomplete') ||
                k.toLowerCase().includes('suggest') ||
                k.toLowerCase().includes('contact') ||
                k.toLowerCase().includes('recipient')
              );
              if (autocompleteTreeKeys.length > 0) {
                treeAutocomplete = autocompleteTreeKeys;
              }
            }
          } catch (e) {}

          return {
            viewStateKeys: keys.slice(0, 50),
            autocompleteKeys,
            treeAutocomplete,
          };
        })()
      `,
      returnByValue: true,
    });

    const viewStateData = viewStateResult.result.value as {
      viewStateKeys?: string[];
      autocompleteKeys?: string[];
      treeAutocomplete?: string[];
      error?: string;
    };

    if (viewStateData.error) {
      console.log("ViewState not found");
    } else {
      console.log(`ViewState keys: ${viewStateData.viewStateKeys?.slice(0, 20).join(", ")}...`);
      console.log(`Autocomplete-related keys: ${viewStateData.autocompleteKeys?.join(", ") || "none"}`);
      console.log(`Tree autocomplete keys: ${viewStateData.treeAutocomplete?.join(", ") || "none"}`);
    }

    // Step 7: Check compose form controller for autocomplete
    console.log("\nStep 7: Checking compose form for autocomplete...");
    const composeResult = await Runtime.evaluate({
      expression: `
        (() => {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "Compose form controller not found" };

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "No draft found" };

          const ctrl = cfc[draftKey];
          if (!ctrl) return { error: "Draft controller not found" };

          // Get all keys on the controller
          const ctrlKeys = Object.keys(ctrl);

          // Look for autocomplete-related properties
          const autocompleteProps = ctrlKeys.filter(k =>
            k.toLowerCase().includes('autocomplete') ||
            k.toLowerCase().includes('suggest') ||
            k.toLowerCase().includes('contact') ||
            k.toLowerCase().includes('recipient')
          );

          // Check state for autocomplete
          let stateAutocomplete = null;
          if (ctrl.state) {
            const stateKeys = Object.keys(ctrl.state);
            stateAutocomplete = stateKeys.filter(k =>
              k.toLowerCase().includes('autocomplete') ||
              k.toLowerCase().includes('suggest') ||
              k.toLowerCase().includes('contact') ||
              k.toLowerCase().includes('recipient')
            );
          }

          // Check for any method that looks like autocomplete
          const methods = Object.keys(ctrl).filter(k => typeof ctrl[k] === 'function');
          const autocompleteMethods = methods.filter(m =>
            m.toLowerCase().includes('autocomplete') ||
            m.toLowerCase().includes('suggest') ||
            m.toLowerCase().includes('complete') ||
            m.toLowerCase().includes('search') ||
            m.toLowerCase().includes('lookup')
          );

          return {
            controllerKeys: ctrlKeys.slice(0, 30),
            autocompleteProps,
            stateAutocomplete,
            autocompleteMethods,
            allMethods: methods.slice(0, 30),
          };
        })()
      `,
      returnByValue: true,
    });

    const composeData = composeResult.result.value as {
      controllerKeys?: string[];
      autocompleteProps?: string[];
      stateAutocomplete?: string[];
      autocompleteMethods?: string[];
      allMethods?: string[];
      error?: string;
    };

    if (composeData.error) {
      console.log(`Compose form: ${composeData.error}`);
    } else {
      console.log(`Controller keys: ${composeData.controllerKeys?.join(", ")}`);
      console.log(`Autocomplete props: ${composeData.autocompleteProps?.join(", ") || "none"}`);
      console.log(`State autocomplete: ${composeData.stateAutocomplete?.join(", ") || "none"}`);
      console.log(`Autocomplete methods: ${composeData.autocompleteMethods?.join(", ") || "none"}`);
      console.log(`All methods: ${composeData.allMethods?.join(", ")}`);
    }

    // Step 8: Deep dive - check Google People API directly
    console.log("\nStep 8: Checking for Google People API access...");
    const peopleApiResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const ga = window.GoogleAccount;
          const di = ga?.di;
          const gmail = di?.get?.('gmail');

          if (!gmail) return { error: "gmail not found" };

          // Check if gmail has _getAsync or _postAsync for People API calls
          const hasGetAsync = typeof gmail._getAsync === 'function';
          const hasPostAsync = typeof gmail._postAsync === 'function';

          // Try to make a People API call
          let peopleApiTest = null;
          if (hasGetAsync) {
            try {
              // Google People API endpoint for connections (contacts)
              const result = await gmail._getAsync(
                'https://people.googleapis.com/v1/people/me/connections',
                { personFields: 'names,emailAddresses', pageSize: 10 }
              );
              peopleApiTest = {
                success: true,
                hasContacts: result?.connections?.length > 0,
                contactCount: result?.connections?.length || 0,
                sampleContact: result?.connections?.[0] ? {
                  name: result.connections[0].names?.[0]?.displayName,
                  email: result.connections[0].emailAddresses?.[0]?.value,
                } : null,
              };
            } catch (e) {
              peopleApiTest = {
                success: false,
                error: e.message?.substring(0, 200),
              };
            }
          }

          // Try People API search
          let searchTest = null;
          if (hasGetAsync) {
            try {
              const result = await gmail._getAsync(
                'https://people.googleapis.com/v1/people:searchContacts',
                { query: 'a', readMask: 'names,emailAddresses', pageSize: 5 }
              );
              searchTest = {
                success: true,
                hasResults: result?.results?.length > 0,
                resultCount: result?.results?.length || 0,
              };
            } catch (e) {
              searchTest = {
                success: false,
                error: e.message?.substring(0, 200),
              };
            }
          }

          return {
            hasGetAsync,
            hasPostAsync,
            peopleApiTest,
            searchTest,
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const peopleData = peopleApiResult.result.value as {
      hasGetAsync?: boolean;
      hasPostAsync?: boolean;
      peopleApiTest?: any;
      searchTest?: any;
      error?: string;
    };

    console.log(`Gmail has _getAsync: ${peopleData.hasGetAsync}`);
    console.log(`Gmail has _postAsync: ${peopleData.hasPostAsync}`);
    console.log("People API connections test:", JSON.stringify(peopleData.peopleApiTest, null, 2));
    console.log("People API search test:", JSON.stringify(peopleData.searchTest, null, 2));

    // Step 9: Check Microsoft Graph contacts (if Microsoft account)
    console.log("\nStep 9: Checking Microsoft Graph contacts...");
    const msContactsResult = await Runtime.evaluate({
      expression: `
        (async () => {
          const di = window.GoogleAccount?.di;
          const isMicrosoft = di?.get?.('isMicrosoft');

          if (!isMicrosoft) {
            return { skip: true, reason: "Not a Microsoft account" };
          }

          const msgraph = di?.get?.('msgraph');
          if (!msgraph) return { error: "msgraph not found" };

          // Check for _fetchJSONWithRetry
          const hasFetch = typeof msgraph._fetchJSONWithRetry === 'function';
          const hasFullURL = typeof msgraph._fullURL === 'function';

          // Try to fetch contacts
          let contactsTest = null;
          if (hasFetch && hasFullURL) {
            try {
              const url = msgraph._fullURL('/v1.0/me/contacts', {});
              const result = await msgraph._fetchJSONWithRetry(url, {
                method: 'GET',
                endpoint: 'contacts.list'
              });
              contactsTest = {
                success: true,
                hasContacts: result?.value?.length > 0,
                contactCount: result?.value?.length || 0,
                sampleContact: result?.value?.[0] ? {
                  name: result.value[0].displayName,
                  email: result.value[0].emailAddresses?.[0]?.address,
                } : null,
              };
            } catch (e) {
              contactsTest = {
                success: false,
                error: e.message?.substring(0, 200),
              };
            }
          }

          // Try to search people
          let searchTest = null;
          if (hasFetch && hasFullURL) {
            try {
              const url = msgraph._fullURL('/v1.0/me/people', { '$search': 'a', '$top': 5 });
              const result = await msgraph._fetchJSONWithRetry(url, {
                method: 'GET',
                endpoint: 'people.search'
              });
              searchTest = {
                success: true,
                hasResults: result?.value?.length > 0,
                resultCount: result?.value?.length || 0,
              };
            } catch (e) {
              searchTest = {
                success: false,
                error: e.message?.substring(0, 200),
              };
            }
          }

          return {
            hasFetch,
            hasFullURL,
            contactsTest,
            searchTest,
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    const msContactsData = msContactsResult.result.value as any;

    if (msContactsData.skip) {
      console.log(msContactsData.reason);
    } else if (msContactsData.error) {
      console.log(`Error: ${msContactsData.error}`);
    } else {
      console.log(`Msgraph has _fetchJSONWithRetry: ${msContactsData.hasFetch}`);
      console.log(`Msgraph has _fullURL: ${msContactsData.hasFullURL}`);
      console.log("Contacts test:", JSON.stringify(msContactsData.contactsTest, null, 2));
      console.log("People search test:", JSON.stringify(msContactsData.searchTest, null, 2));
    }

    // Final summary
    console.log("\n" + "=".repeat(60));
    console.log("DISCOVERY SUMMARY");
    console.log("=".repeat(60));
    console.log(`
Key findings:
1. DI container services: ${diData.services?.join(', ') || 'none found'}
2. Contact-specific DI services: ${contactServices.services?.map(s => s.name).join(', ') || 'NONE'}
3. Gmail contact methods: ${gmailData.methods?.join(', ') || 'NONE'}
4. Msgraph contact methods: ${msgraphData.methods?.join(', ') || 'NONE or N/A'}
5. People API (Google) - connections: ${peopleData.peopleApiTest?.success ? 'WORKS' : 'FAILED'}
6. People API (Google) - search: ${peopleData.searchTest?.success ? 'WORKS' : 'FAILED'}
7. Microsoft contacts: ${msContactsData.skip ? 'N/A (Google account)' : (msContactsData.contactsTest?.success ? 'WORKS' : 'FAILED')}
    `);

  } finally {
    await disconnect(conn);
    console.log("\nDisconnected from Superhuman");
  }
}

discoverContactsApis().catch(console.error);
