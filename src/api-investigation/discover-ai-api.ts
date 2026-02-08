/**
 * Discover Superhuman AI API Endpoints
 *
 * Run this while using "Ask AI" in Superhuman to capture the API calls.
 *
 * Usage:
 * 1. Start Superhuman with --remote-debugging-port=9333
 * 2. Run: bun src/api-investigation/discover-ai-api.ts
 * 3. In Superhuman, open a thread and use "Ask AI" feature
 * 4. Watch the console for captured API calls
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

const CDP_PORT = 9333;

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(CDP_PORT);

  if (!conn) {
    console.error("Failed to connect. Make sure Superhuman is running with CDP.");
    process.exit(1);
  }

  const { Runtime, Network } = conn;

  // Enable network monitoring
  await Network.enable();

  console.log("\n=== Monitoring for AI API calls ===");
  console.log("Now use 'Ask AI' in Superhuman to capture the endpoints.\n");

  // Capture all requests
  Network.requestWillBeSent((params) => {
    const url = params.request.url;

    // Filter for likely AI-related endpoints
    if (
      url.includes("ai") ||
      url.includes("assist") ||
      url.includes("suggest") ||
      url.includes("generate") ||
      url.includes("chat") ||
      url.includes("completion") ||
      url.includes("summarize") ||
      url.includes("superhuman.com")
    ) {
      console.log("\n--- Request Captured ---");
      console.log("URL:", url);
      console.log("Method:", params.request.method);

      if (params.request.postData) {
        try {
          const body = JSON.parse(params.request.postData);
          console.log("Body:", JSON.stringify(body, null, 2));
        } catch {
          console.log("Body (raw):", params.request.postData);
        }
      }

      // Log headers (filter for auth)
      const headers = params.request.headers;
      if (headers.Authorization || headers.authorization) {
        console.log("Auth:", (headers.Authorization || headers.authorization).substring(0, 50) + "...");
      }
    }
  });

  // Also capture responses
  Network.responseReceived((params) => {
    const url = params.response.url;

    if (
      url.includes("ai") ||
      url.includes("assist") ||
      url.includes("suggest") ||
      url.includes("generate") ||
      url.includes("chat") ||
      url.includes("completion") ||
      url.includes("summarize")
    ) {
      console.log("\n--- Response Received ---");
      console.log("URL:", url);
      console.log("Status:", params.response.status);
    }
  });

  // Also explore the DI container for AI services
  console.log("\n=== Exploring DI Container for AI Services ===\n");

  const diResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga || !ga.di) return { error: "No DI container found" };

        const di = ga.di;
        const services = [];

        // Try to list all services
        if (di._services) {
          for (const key of Object.keys(di._services)) {
            services.push(key);
          }
        }

        // Try to get specific AI-related services
        const aiServices = {};
        const tryGet = (name) => {
          try {
            const svc = di.get(name);
            if (svc) {
              aiServices[name] = typeof svc;
              if (typeof svc === 'object') {
                aiServices[name + '_methods'] = Object.keys(svc).filter(k => typeof svc[k] === 'function').slice(0, 10);
              }
            }
          } catch (e) {}
        };

        // Common AI service names
        ['ai', 'assistant', 'aiAssistant', 'smartCompose', 'suggest', 'autocomplete',
         'aiService', 'assistantService', 'completion', 'llm', 'gpt'].forEach(tryGet);

        return {
          allServices: services.filter(s =>
            s.toLowerCase().includes('ai') ||
            s.toLowerCase().includes('assist') ||
            s.toLowerCase().includes('suggest') ||
            s.toLowerCase().includes('smart') ||
            s.toLowerCase().includes('compose')
          ),
          aiServices,
          totalServices: services.length
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("DI Container Analysis:", JSON.stringify(diResult.result.value, null, 2));

  // Explore backend object for AI methods
  console.log("\n=== Exploring Backend Object for AI Methods ===\n");

  const backendResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        if (!ga || !ga.backend) return { error: "No backend found" };

        const backend = ga.backend;
        const methods = Object.keys(backend).filter(k => typeof backend[k] === 'function');

        // Find AI-related methods
        const aiMethods = methods.filter(m =>
          m.toLowerCase().includes('ai') ||
          m.toLowerCase().includes('assist') ||
          m.toLowerCase().includes('suggest') ||
          m.toLowerCase().includes('summarize') ||
          m.toLowerCase().includes('generate') ||
          m.toLowerCase().includes('ask')
        );

        return {
          aiMethods,
          allMethods: methods.slice(0, 50),
          totalMethods: methods.length
        };
      })()
    `,
    returnByValue: true,
  });

  console.log("Backend Methods Analysis:", JSON.stringify(backendResult.result.value, null, 2));

  // Keep running to capture network traffic
  console.log("\n=== Monitoring network traffic... Press Ctrl+C to stop ===\n");

  // Keep the process alive
  await new Promise(() => {});
}

main().catch(console.error);
