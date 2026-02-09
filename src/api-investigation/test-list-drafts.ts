#!/usr/bin/env bun
/**
 * Test Superhuman Native Drafts Listing
 * 
 * Explores how to list Superhuman's native drafts (draft00...) via CDP
 */

import { connectToSuperhuman } from "../superhuman-api";

async function exploreDrafts(conn: { Runtime: any }) {
  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (() => {
        try {
          const backend = window.GoogleAccount?.backend;
          if (!backend) return { error: "No backend" };

          const backendKeys = Object.keys(backend).slice(0, 100);
          const backendMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(backend))
            .filter(k => typeof backend[k] === 'function').slice(0, 100);

          return { backendKeys, backendMethods };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `,
    returnByValue: true,
  });

  return result.result.value;
}

async function main() {
  console.log("Connecting to Superhuman...");
  const conn = await connectToSuperhuman(9333, false);
  if (!conn) {
    console.error("Failed to connect to Superhuman");
    process.exit(1);
  }

  console.log("Exploring drafts...\n");
  
  const draftsInfo = await exploreDrafts(conn);
  console.log("Drafts info:", JSON.stringify(draftsInfo, null, 2));

  process.exit(0);
}

main();
