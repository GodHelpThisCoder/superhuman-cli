/**
 * Investigate Ask AI sidebar service via DI container inspection.
 *
 * Connects to Superhuman via CDP and searches for AI sidebar services,
 * enumerating methods and dumping source code of promising ones.
 */

import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

const CDP_PORT = 9333;

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect. Make sure Superhuman is running with CDP.");
    process.exit(1);
  }

  const { Runtime } = conn;

  // 1. Search DI container for AI-related services
  console.log("\n=== DI Container: AI/Sidebar/Chat/Agent Services ===\n");

  const diResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.di) return { error: "No DI container found" };

        const searchTerms = ['ai', 'ask', 'sidebar', 'agent', 'chat', 'compose', 'assist', 'smart', 'suggest', 'generate', 'llm', 'copilot', 'prompt'];
        const found = {};

        // Search _services map
        if (ga.di._services) {
          for (const [key, value] of Object.entries(ga.di._services)) {
            const lowerKey = key.toLowerCase();
            if (searchTerms.some(term => lowerKey.includes(term))) {
              found[key] = {
                type: typeof value,
                isFunction: typeof value === 'function',
                hasInstance: value != null,
              };
            }
          }
        }

        // Also search using di.get with known patterns
        if (ga.di.get) {
          const knownServices = [
            'aiService', 'AIService', 'AiService',
            'askAIService', 'AskAIService',
            'sidebarAI', 'SidebarAI', 'SidebarAIAgent',
            'aiChat', 'AIChat', 'AiChat',
            'aiAgent', 'AIAgent', 'AiAgent',
            'aiCompose', 'AICompose', 'AiCompose',
            'chatService', 'ChatService',
            'aiSidebar', 'AISidebar',
            'composeAgent', 'ComposeAgent',
            'aiComposeService', 'AIComposeService',
          ];
          for (const svc of knownServices) {
            try {
              const instance = ga.di.get(svc);
              if (instance) {
                found['di.get("' + svc + '")'] = {
                  type: typeof instance,
                  constructor: instance?.constructor?.name || 'unknown',
                  keys: Object.keys(instance).slice(0, 20),
                };
              }
            } catch {}
          }
        }

        return found;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(diResult.result.value, null, 2));

  // 2. Get ALL DI service keys (full list)
  console.log("\n=== All DI Service Keys ===\n");

  const allKeysResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.di?._services) return [];
        return Object.keys(ga.di._services).sort();
      })()
    `,
    returnByValue: true,
  });

  const allKeys = allKeysResult.result.value as string[];
  console.log(`Total services: ${allKeys.length}`);
  console.log(JSON.stringify(allKeys, null, 2));

  // 3. For each AI-related service, enumerate methods via prototype
  console.log("\n=== Methods on AI-Related Services ===\n");

  const methodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.di?._services) return {};

        const searchTerms = ['ai', 'ask', 'sidebar', 'agent', 'chat', 'compose', 'assist', 'smart', 'suggest'];
        const results = {};

        for (const [key, value] of Object.entries(ga.di._services)) {
          const lowerKey = key.toLowerCase();
          if (!searchTerms.some(term => lowerKey.includes(term))) continue;

          const methods = [];

          // Check prototype methods
          if (value && typeof value === 'object') {
            const proto = Object.getPrototypeOf(value);
            if (proto) {
              const protoMethods = Object.getOwnPropertyNames(proto)
                .filter(m => typeof proto[m] === 'function' && m !== 'constructor');
              methods.push(...protoMethods.map(m => '(proto) ' + m));
            }

            // Check own methods
            const ownMethods = Object.keys(value)
              .filter(k => typeof value[k] === 'function');
            methods.push(...ownMethods.map(m => '(own) ' + m));

            // Check own properties that are not functions
            const ownProps = Object.keys(value)
              .filter(k => typeof value[k] !== 'function')
              .map(k => '(prop) ' + k + ': ' + typeof value[k]);
            methods.push(...ownProps.slice(0, 15));
          } else if (typeof value === 'function') {
            methods.push('(is a function/constructor)');
            const proto = value.prototype;
            if (proto) {
              const protoMethods = Object.getOwnPropertyNames(proto)
                .filter(m => typeof proto[m] === 'function' && m !== 'constructor');
              methods.push(...protoMethods.map(m => '(fn.proto) ' + m));
            }
          }

          if (methods.length > 0) {
            results[key] = methods;
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(methodsResult.result.value, null, 2));

  // 4. Look specifically for services that handle chat-like interactions
  console.log("\n=== Searching for sendMessage/ask/query/chat Methods ===\n");

  const chatMethodsResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.di?._services) return {};

        const targetMethods = ['send', 'ask', 'query', 'chat', 'message', 'compose', 'generate', 'stream', 'fetch', 'request', 'prompt'];
        const results = {};

        for (const [key, value] of Object.entries(ga.di._services)) {
          if (!value || typeof value !== 'object') continue;

          const matchingMethods = [];

          // Check prototype
          const proto = Object.getPrototypeOf(value);
          if (proto) {
            for (const method of Object.getOwnPropertyNames(proto)) {
              if (typeof proto[method] !== 'function' || method === 'constructor') continue;
              const lowerMethod = method.toLowerCase();
              if (targetMethods.some(t => lowerMethod.includes(t))) {
                matchingMethods.push(method);
              }
            }
          }

          // Check own methods
          for (const method of Object.keys(value)) {
            if (typeof value[method] !== 'function') continue;
            const lowerMethod = method.toLowerCase();
            if (targetMethods.some(t => lowerMethod.includes(t))) {
              matchingMethods.push(method);
            }
          }

          if (matchingMethods.length > 0) {
            results[key] = matchingMethods;
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(chatMethodsResult.result.value, null, 2));

  // 5. Dump source of promising methods (first 1500 chars)
  console.log("\n=== Source Code of Promising AI Methods ===\n");

  const sourceResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.di?._services) return {};

        const aiTerms = ['ai', 'ask', 'sidebar', 'agent', 'chat', 'compose', 'assist'];
        const chatTerms = ['send', 'ask', 'query', 'chat', 'message', 'compose', 'generate', 'stream', 'prompt'];
        const results = {};

        for (const [key, value] of Object.entries(ga.di._services)) {
          const lowerKey = key.toLowerCase();
          if (!aiTerms.some(term => lowerKey.includes(term))) continue;
          if (!value || typeof value !== 'object') continue;

          // Collect method sources from prototype
          const proto = Object.getPrototypeOf(value);
          if (proto) {
            for (const method of Object.getOwnPropertyNames(proto)) {
              if (typeof proto[method] !== 'function' || method === 'constructor') continue;
              const lowerMethod = method.toLowerCase();
              if (chatTerms.some(t => lowerMethod.includes(t))) {
                const source = proto[method].toString().substring(0, 1500);
                results[key + '.' + method] = source;
              }
            }
          }

          // Collect method sources from own properties
          for (const method of Object.keys(value)) {
            if (typeof value[method] !== 'function') continue;
            const lowerMethod = method.toLowerCase();
            if (chatTerms.some(t => lowerMethod.includes(t))) {
              const source = value[method].toString().substring(0, 1500);
              results[key + '.' + method] = source;
            }
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  const sources = sourceResult.result.value as Record<string, string>;
  for (const [name, source] of Object.entries(sources)) {
    console.log(`\n--- ${name} ---`);
    console.log(source);
  }

  // 6. Check GoogleAccount.backend for AI methods and dump their source
  console.log("\n=== Backend AI Method Sources ===\n");

  const backendResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga?.backend) return {};

        const aiTerms = ['ai', 'compose', 'ask', 'agent', 'chat', 'suggest', 'smart'];
        const results = {};

        // Check prototype methods
        const proto = Object.getPrototypeOf(ga.backend);
        if (proto) {
          for (const method of Object.getOwnPropertyNames(proto)) {
            if (typeof proto[method] !== 'function' || method === 'constructor') continue;
            const lowerMethod = method.toLowerCase();
            if (aiTerms.some(t => lowerMethod.includes(t))) {
              results['backend.' + method] = proto[method].toString().substring(0, 2000);
            }
          }
        }

        // Also check own properties
        for (const key of Object.keys(ga.backend)) {
          if (typeof ga.backend[key] !== 'function') continue;
          const lowerKey = key.toLowerCase();
          if (aiTerms.some(t => lowerKey.includes(t))) {
            results['backend.' + key] = ga.backend[key].toString().substring(0, 2000);
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  const backendSources = backendResult.result.value as Record<string, string>;
  for (const [name, source] of Object.entries(backendSources)) {
    console.log(`\n--- ${name} ---`);
    console.log(source);
  }

  // 7. Look at ViewState for any AI-related state or commands
  console.log("\n=== ViewState AI/Sidebar Properties ===\n");

  const viewStateResult = await Runtime.evaluate({
    expression: `
      (() => {
        const vs = window.ViewState;
        if (!vs) return { error: "No ViewState" };

        const aiTerms = ['ai', 'ask', 'sidebar', 'agent', 'chat', 'compose', 'assist'];
        const found = {};

        // Search ViewState keys
        for (const key of Object.keys(vs)) {
          const lowerKey = key.toLowerCase();
          if (aiTerms.some(term => lowerKey.includes(term))) {
            const val = vs[key];
            found[key] = {
              type: typeof val,
              value: typeof val === 'object' && val !== null
                ? Object.keys(val).slice(0, 20)
                : String(val).substring(0, 200)
            };
          }
        }

        // Search ViewState.tree data
        const tree = vs?.tree;
        if (tree) {
          const data = tree.get?.() || tree._data;
          if (data) {
            for (const key of Object.keys(data)) {
              const lowerKey = key.toLowerCase();
              if (aiTerms.some(term => lowerKey.includes(term))) {
                const val = data[key];
                found['tree.' + key] = {
                  type: typeof val,
                  value: typeof val === 'object' && val !== null
                    ? JSON.stringify(val).substring(0, 500)
                    : String(val).substring(0, 200)
                };
              }
            }
          }
        }

        // Check regional commands for AI-related commands
        const rc = vs?.regionalCommands;
        if (rc && Array.isArray(rc)) {
          const aiCommands = [];
          for (const region of rc) {
            if (region?.commands) {
              for (const cmd of region.commands) {
                const id = cmd.id?.toLowerCase() || '';
                if (aiTerms.some(term => id.includes(term))) {
                  aiCommands.push({
                    id: cmd.id,
                    label: cmd.label || cmd.name || '',
                    hasAction: typeof cmd.action === 'function',
                  });
                }
              }
            }
          }
          if (aiCommands.length > 0) {
            found['regionalCommands'] = aiCommands;
          }
        }

        return found;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(viewStateResult.result.value, null, 2));

  // 8. Search for any class that matches AI patterns using global search
  console.log("\n=== Global Search for AI Classes/Constructors ===\n");

  const globalResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga) return {};

        const results = {};

        // Deep search: look at all properties of GoogleAccount recursively (1 level)
        const aiTerms = ['ai', 'ask', 'sidebar', 'agent', 'chat'];

        for (const key of Object.keys(ga)) {
          const val = ga[key];
          if (!val || typeof val !== 'object') continue;

          // Check if this object has AI-related methods
          const proto = Object.getPrototypeOf(val);
          if (!proto) continue;

          const constructorName = val.constructor?.name || '';
          const lowerName = constructorName.toLowerCase();

          if (aiTerms.some(t => lowerName.includes(t))) {
            results[key + ' (' + constructorName + ')'] = {
              methods: Object.getOwnPropertyNames(proto)
                .filter(m => typeof proto[m] === 'function' && m !== 'constructor'),
              ownKeys: Object.keys(val).slice(0, 20),
            };
          }

          // Also check sub-properties
          for (const subKey of Object.keys(val)) {
            try {
              const subVal = val[subKey];
              if (!subVal || typeof subVal !== 'object') continue;
              const subName = subVal.constructor?.name || '';
              const lowerSubName = subName.toLowerCase();
              if (aiTerms.some(t => lowerSubName.includes(t))) {
                const subProto = Object.getPrototypeOf(subVal);
                results[key + '.' + subKey + ' (' + subName + ')'] = {
                  methods: subProto ? Object.getOwnPropertyNames(subProto)
                    .filter(m => typeof subProto[m] === 'function' && m !== 'constructor') : [],
                  ownKeys: Object.keys(subVal).slice(0, 20),
                };
              }
            } catch {}
          }
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(globalResult.result.value, null, 2));

  await disconnect(conn);
  console.log("\nDone.");
}

main().catch(console.error);
