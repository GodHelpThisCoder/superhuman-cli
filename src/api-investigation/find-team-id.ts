/**
 * Find team ID in Superhuman
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const backend = ga?.backend;
        const credential = ga?.credential;

        const teamIdSources = {};

        // From backend._credential
        if (backend?._credential) {
          const cred = backend._credential;
          teamIdSources["backend._credential keys"] = Object.keys(cred);
          if (cred.user) {
            teamIdSources["backend._credential.user"] = typeof cred.user === 'object' ? Object.keys(cred.user) : cred.user;
          }
        }

        // From credential
        if (credential) {
          if (credential.user) {
            teamIdSources["credential.user"] = typeof credential.user === 'object' ? Object.keys(credential.user) : credential.user;
          }
          if (credential._authData?.userId) {
            teamIdSources["credential._authData.userId"] = credential._authData.userId;
          }
        }

        // Look in DI for anything with 'team' in name
        if (di?._services) {
          const teamServices = Object.keys(di._services).filter(k =>
            k.toLowerCase().includes('team') ||
            k.toLowerCase().includes('user') ||
            k.toLowerCase().includes('account')
          );
          teamIdSources["teamServices"] = teamServices;

          // Try to get team-related data
          for (const svcName of teamServices.slice(0, 5)) {
            try {
              const svc = di.get(svcName);
              if (svc && typeof svc === 'object') {
                const keys = Object.keys(svc);
                if (keys.length < 20) {
                  teamIdSources["svc:" + svcName] = keys;
                }
              }
            } catch {}
          }
        }

        return teamIdSources;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
