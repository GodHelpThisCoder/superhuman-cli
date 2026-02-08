#!/usr/bin/env bun
/**
 * Contacts Trie Exploration
 *
 * Explores the trie data structure used for contact autocomplete in Superhuman.
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function exploreTrieSearch() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const { Runtime } = conn;

  const result = await Runtime.evaluate({
    expression: `
      (async () => {
        const di = window.GoogleAccount?.di;
        const contacts = di?.get?.('contacts');

        if (!contacts) {
          return { error: 'contacts service not found' };
        }

        await contacts.loadAsync?.();

        const info = {};

        // Check the trie structure and methods
        const trie = contacts._orderedContactsTrie;
        if (trie) {
          info.trieMethods = Object.getOwnPropertyNames(trie)
            .filter(k => typeof trie[k] === 'function');

          // Get proto chain methods too
          let proto = Object.getPrototypeOf(trie);
          info.trieProtoMethods = [];
          while (proto && proto !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(proto)) {
              if (typeof trie[name] === 'function') {
                info.trieProtoMethods.push(name);
              }
            }
            proto = Object.getPrototypeOf(proto);
          }
        }

        // Try searching the addressBook directly
        const ab = contacts._addressBook;
        if (ab) {
          info.addressBookType = ab.constructor?.name;

          // If addressBook is a Map, try to filter by prefix
          if (ab instanceof Map) {
            info.addressBookSize = ab.size;
            const matches = [];
            for (const [email, contact] of ab) {
              const name = contact?.name || contact?.displayName || '';
              if (name.toLowerCase().startsWith('ed') || email.toLowerCase().includes('ed')) {
                matches.push({
                  email,
                  name: contact?.name || contact?.displayName,
                });
                if (matches.length >= 10) break;
              }
            }
            info.prefixSearchResults = matches;
          } else {
            // Not a map - check what it is
            info.addressBookKeys = Object.keys(ab).slice(0, 20);
          }
        }

        // Check contacts store prototype for search methods
        let protoMethods = [];
        let proto = Object.getPrototypeOf(contacts);
        while (proto && proto !== Object.prototype) {
          for (const name of Object.getOwnPropertyNames(proto)) {
            if (typeof contacts[name] === 'function') {
              protoMethods.push({
                name,
                argCount: contacts[name].length,
                source: contacts[name].toString().substring(0, 200),
              });
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
        info.contactStoreProtoMethods = protoMethods;

        // Check gmail service for contact-related methods
        const gmail = di?.get?.('gmail');
        if (gmail) {
          const gmailMethods = [];
          for (const name of Object.getOwnPropertyNames(gmail)) {
            if (typeof gmail[name] === 'function' &&
                (name.toLowerCase().includes('contact') ||
                 name.toLowerCase().includes('people') ||
                 name.toLowerCase().includes('directory'))) {
              gmailMethods.push({
                name,
                argCount: gmail[name].length,
                source: gmail[name].toString().substring(0, 300),
              });
            }
          }
          info.gmailContactMethods = gmailMethods;

          // Try getPersonalContacts
          if (typeof gmail.getPersonalContacts === 'function') {
            try {
              const personal = await gmail.getPersonalContacts();
              info.personalContactsCount = personal?.length || 0;
              info.personalContactsSample = (personal || []).slice(0, 3).map(c => ({
                name: c.name || c.names?.[0]?.displayName,
                email: c.email || c.emailAddresses?.[0]?.value,
              }));
            } catch (e) {
              info.personalContactsError = e.message;
            }
          }

          // Try getDirectoryContacts (for Google Workspace directory)
          if (typeof gmail.getDirectoryContacts === 'function') {
            try {
              const directory = await gmail.getDirectoryContacts();
              info.directoryContactsCount = directory?.length || 0;
              info.directoryContactsSample = (directory || []).slice(0, 3).map(c => ({
                name: c.name || c.names?.[0]?.displayName,
                email: c.email || c.emailAddresses?.[0]?.value,
              }));
            } catch (e) {
              info.directoryContactsError = e.message;
            }
          }
        }

        // Check msgraph service for contact methods
        const msgraph = di?.get?.('msgraph');
        if (msgraph) {
          // Try getPeople
          if (typeof msgraph.getPeople === 'function') {
            try {
              const people = await msgraph.getPeople();
              info.msgraphPeopleCount = people?.length || 0;
              info.msgraphPeopleSample = (people || []).slice(0, 3).map(c => ({
                name: c.displayName,
                email: c.emailAddresses?.[0]?.address || c.scoredEmailAddresses?.[0]?.address,
              }));
            } catch (e) {
              info.msgraphPeopleError = e.message;
            }
          }

          // Check getPeople signature
          if (typeof msgraph.getPeople === 'function') {
            info.getPeopleSignature = msgraph.getPeople.toString().substring(0, 500);
          }
        }

        return info;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

exploreTrieSearch().catch(console.error);
