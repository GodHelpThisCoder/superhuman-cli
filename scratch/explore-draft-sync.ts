import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // Explore the sync mechanism
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        const disk = di.get('disk');
        const threads = di.get('threads');
        const backend = di.get('backend');

        const findings = {};

        // Check if there's a sharedDraft or draftSync concept
        if (threads) {
          // Look for draft-related properties
          findings.threadsProps = Object.keys(threads).filter(k =>
            k.toLowerCase().includes('draft') ||
            k.toLowerCase().includes('shared')
          );

          // Check if threads has a drafts collection
          if (threads.drafts) {
            findings.threadsDrafts = {
              type: typeof threads.drafts,
              keys: Object.keys(threads.drafts).slice(0, 20)
            };
          }

          // Check identityMap for drafts
          if (threads.identityMap) {
            const draftIds = [];
            try {
              for (const [key, value] of threads.identityMap) {
                if (key.startsWith('draft')) {
                  draftIds.push(key);
                }
              }
            } catch {}
            findings.draftsInIdentityMap = draftIds.slice(0, 10);
          }
        }

        // Check for SharedDraft or similar concepts
        const checkServices = ['SharedDraftService', 'DraftSync', 'SharedDraft', 'DraftBackend'];
        for (const name of checkServices) {
          try {
            const svc = di.get(name);
            if (svc) {
              findings[name] = Object.keys(svc).slice(0, 20);
            }
          } catch {}
        }

        // Check the backend service more thoroughly
        if (backend) {
          findings.backendAllMethods = Object.keys(backend).filter(k => typeof backend[k] === 'function');
          findings.backendProps = Object.keys(backend).filter(k => typeof backend[k] !== 'function').slice(0, 30);

          // Check _credential for API access
          if (backend._credential) {
            findings.hasCredential = true;
          }
        }

        // Check for any websocket connections that might sync drafts
        findings.hasWebSocket = typeof WebSocket !== 'undefined';

        // Check networkManager for sync endpoints
        const networkManager = di.get('networkManager');
        if (networkManager) {
          findings.networkManagerMethods = Object.keys(networkManager).filter(k =>
            typeof networkManager[k] === 'function'
          ).slice(0, 20);
        }

        // Check for portal service (might handle real-time sync)
        const portal = di.get('portal');
        if (portal) {
          findings.portalMethods = Object.keys(portal).filter(k =>
            typeof portal[k] === 'function'
          ).slice(0, 20);
          findings.portalProps = Object.keys(portal).filter(k =>
            typeof portal[k] !== 'function' &&
            (k.includes('socket') || k.includes('channel') || k.includes('connect'))
          );
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("Draft sync investigation:", JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
