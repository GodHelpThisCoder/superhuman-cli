/**
 * Find existing event IDs in Superhuman app
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        // Search through all window properties for event IDs
        const eventIds = [];
        const teamIds = [];
        const otherIds = [];

        function searchObject(obj, path, depth = 0) {
          if (depth > 5 || !obj || typeof obj !== 'object') return;

          try {
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === 'string') {
                if (value.startsWith('event_')) {
                  eventIds.push({ path: path + '.' + key, value });
                } else if (value.startsWith('team_')) {
                  teamIds.push({ path: path + '.' + key, value });
                } else if (value.match(/^[a-zA-Z0-9_]{10,30}$/) && key.toLowerCase().includes('id')) {
                  otherIds.push({ path: path + '.' + key, value: value.substring(0, 30) });
                }
              } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                searchObject(value, path + '.' + key, depth + 1);
              }
            }
          } catch {}
        }

        // Search GoogleAccount
        const ga = window.GoogleAccount;
        if (ga) {
          searchObject(ga, 'ga', 0);
        }

        // Look for specific patterns in local storage
        const storageEventIds = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            if (value && value.includes('event_')) {
              const matches = value.match(/event_[a-zA-Z0-9]{10,20}/g);
              if (matches) {
                storageEventIds.push(...matches.slice(0, 5));
              }
            }
          }
        } catch {}

        return {
          eventIds: eventIds.slice(0, 10),
          teamIds: teamIds.slice(0, 5),
          otherIds: otherIds.slice(0, 10),
          storageEventIds: storageEventIds.slice(0, 10),
        };
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
