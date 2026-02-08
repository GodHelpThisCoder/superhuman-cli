/**
 * List ALL services in Superhuman's DI container
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        if (!di?._services) {
          return { error: 'No DI services found' };
        }

        const allServices = Object.keys(di._services);

        // Categorize services
        const categories = {
          ai: allServices.filter(s => s.toLowerCase().includes('ai')),
          agent: allServices.filter(s => s.toLowerCase().includes('agent')),
          ask: allServices.filter(s => s.toLowerCase().includes('ask')),
          event: allServices.filter(s => s.toLowerCase().includes('event')),
          id: allServices.filter(s => s.toLowerCase().includes('id') && !s.includes('provider')),
          session: allServices.filter(s => s.toLowerCase().includes('session')),
          backend: allServices.filter(s => s.toLowerCase().includes('backend')),
          all: allServices.sort(),
        };

        return {
          totalCount: allServices.length,
          categories,
        };
      })()
    `,
    returnByValue: true,
  });

  const data = result.result.value;
  console.log("Total services:", data.totalCount);
  console.log("\nAI services:", data.categories.ai);
  console.log("\nAgent services:", data.categories.agent);
  console.log("\nAsk services:", data.categories.ask);
  console.log("\nEvent services:", data.categories.event);
  console.log("\nID services:", data.categories.id);
  console.log("\nSession services:", data.categories.session);
  console.log("\nBackend services:", data.categories.backend);
  console.log("\nAll services (first 50):", data.categories.all.slice(0, 50));

  await disconnect(conn);
}

main().catch(console.error);
