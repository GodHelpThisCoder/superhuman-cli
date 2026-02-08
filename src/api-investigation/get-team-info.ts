/**
 * Get team info from Superhuman
 */

import { connectToSuperhuman, disconnect } from "../superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const credential = ga?.credential;
        const di = ga?.di;

        const results = {};

        // Check billing settings for team info
        const user = credential?.user;
        if (user?._billingSettings) {
          results.billingSettings = user._billingSettings;
        }

        // Look for team in di
        if (di) {
          try {
            const team = di.get('team');
            results.diTeam = team ? Object.keys(team) : null;
            if (team?.id) results.teamId = team.id;
            if (team?.teamId) results.teamIdAlt = team.teamId;
          } catch {}

          // Try 'teamSettings'
          try {
            const teamSettings = di.get('teamSettings');
            results.teamSettings = teamSettings;
          } catch {}

          // Try 'userTeam'
          try {
            const userTeam = di.get('userTeam');
            results.userTeam = userTeam ? Object.keys(userTeam) : null;
          } catch {}
        }

        // Check backend for team info
        const backend = ga?.backend;
        if (backend?._credential?.user?._billingSettings?.teamInviteLink) {
          results.teamInviteLink = backend._credential.user._billingSettings.teamInviteLink;
        }

        return results;
      })()
    `,
    returnByValue: true,
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}
main();
