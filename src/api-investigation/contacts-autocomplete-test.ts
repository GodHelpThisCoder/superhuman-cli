#!/usr/bin/env bun
/**
 * Contacts Autocomplete Test
 *
 * Tests the contact autocomplete functionality in Superhuman.
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function testContactsAutocomplete() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  // Test queries
  const testQueries = ["ed", "jo", "a", "mike", "virginia"];

  for (const query of testQueries) {
    console.log(`\n=== Testing query: "${query}" ===\n`);

    const result = await Runtime.evaluate({
      expression: `
        (async () => {
          const di = window.GoogleAccount?.di;
          const contacts = di?.get?.('contacts');

          if (!contacts) {
            return { error: 'contacts service not found' };
          }

          await contacts.loadAsync?.();

          const results = {};

          // Test recipientListAutoCompleteAsync
          if (typeof contacts.recipientListAutoCompleteAsync === 'function') {
            try {
              const autocomplete = await contacts.recipientListAutoCompleteAsync({
                query: ${JSON.stringify(query)},
                limit: 10,
                includeTeamMembers: true,
              });
              results.autocomplete = (autocomplete || []).slice(0, 10).map(c => ({
                email: c.email,
                name: c.name || c.displayName,
                score: c.score,
              }));
            } catch (e) {
              results.autocompleteError = e.message;
            }
          }

          // Test topContactsAsync
          if (typeof contacts.topContactsAsync === 'function') {
            try {
              const top = await contacts.topContactsAsync({
                query: ${JSON.stringify(query)},
                limit: 10,
              });
              results.topContacts = (top || []).slice(0, 10).map(c => ({
                email: c.email,
                name: c.name || c.displayName,
                score: c.score,
              }));
            } catch (e) {
              results.topContactsError = e.message;
            }
          }

          // Test topTeamMembersAsync
          if (typeof contacts.topTeamMembersAsync === 'function') {
            try {
              const team = await contacts.topTeamMembersAsync(${JSON.stringify(query)}, 10);
              results.topTeamMembers = (team || []).slice(0, 10).map(c => ({
                email: c.email,
                name: c.name || c.displayName,
                score: c.score,
              }));
            } catch (e) {
              results.topTeamMembersError = e.message;
            }
          }

          // Test trie query directly
          const trie = contacts._orderedContactsTrie;
          if (trie && typeof trie.query === 'function') {
            try {
              const trieResult = await trie.query(${JSON.stringify(query)}, 10);
              results.trieQuery = {
                contacts: (trieResult?.contacts || []).slice(0, 10).map(c => ({
                  email: c.email,
                  name: c.name || c.displayName,
                  score: c.score,
                })),
              };
            } catch (e) {
              results.trieQueryError = e.message;
            }
          }

          return results;
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });

    console.log(JSON.stringify(result.result.value, null, 2));
  }

  // Also check msgraph for Microsoft account
  console.log("\n=== Testing Microsoft Graph People API ===\n");
  const msResult = await Runtime.evaluate({
    expression: `
      (async () => {
        const di = window.GoogleAccount?.di;
        const isMicrosoft = di?.get?.('isMicrosoft');

        if (!isMicrosoft) {
          return { skip: true, reason: 'Not a Microsoft account' };
        }

        const msgraph = di?.get?.('msgraph');
        if (!msgraph) {
          return { error: 'msgraph not found' };
        }

        // Try people search with query
        if (typeof msgraph._fullURL === 'function' && typeof msgraph._fetchJSONWithRetry === 'function') {
          try {
            const url = msgraph._fullURL('/v1.0/me/people', {
              '$search': '"ed"',
              '$top': '10',
            });
            const result = await msgraph._fetchJSONWithRetry(url, {
              method: 'GET',
              endpoint: 'people.search'
            });
            return {
              peopleSearch: (result?.value || []).map(p => ({
                name: p.displayName,
                email: p.scoredEmailAddresses?.[0]?.address || p.emailAddresses?.[0]?.address,
                score: p.scoredEmailAddresses?.[0]?.relevanceScore,
              }))
            };
          } catch (e) {
            return { error: e.message };
          }
        }

        return { error: 'Required methods not found' };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log(JSON.stringify(msResult.result.value, null, 2));

  await disconnect(conn);
}

testContactsAutocomplete().catch(console.error);
