import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // Check for WebSocket/Firebase connections
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};

        // Check for Firebase
        findings.hasFirebase = typeof firebase !== 'undefined';
        findings.hasFirestore = typeof firebase !== 'undefined' && typeof firebase.firestore === 'function';

        // Check window for any realtime connections
        const ga = window.GoogleAccount;
        const di = ga?.di;

        // Check portal for WebSocket-like behavior
        const portal = di?.get('portal');
        if (portal) {
          findings.portal = {
            isConnected: portal._connected,
            hasPort: !!portal._port,
            methods: Object.keys(portal).filter(k => typeof portal[k] === 'function')
          };
        }

        // Check for any Pusher/Socket.io/Firebase connections
        findings.hasPusher = typeof Pusher !== 'undefined';
        findings.hasSocketIO = typeof io !== 'undefined';

        // Check for any WebSocket instances
        const wsInstances = [];
        if (window._webSockets) {
          wsInstances.push(...window._webSockets);
        }
        findings.wsInstances = wsInstances.length;

        // Check networkManager for polling
        const networkManager = di?.get('networkManager');
        if (networkManager) {
          findings.networkManager = {
            isPollActive: !!networkManager._pollInterval,
            pollInterval: networkManager._pollInterval,
            methods: Object.keys(networkManager).filter(k => typeof networkManager[k] === 'function')
          };
        }

        // Check if there's any real-time sync service
        const checkRealtime = ['realtime', 'sync', 'pusher', 'socket', 'firebase', 'firestore'];
        for (const name of checkRealtime) {
          try {
            const svc = di?.get(name);
            if (svc) {
              findings[name + 'Service'] = Object.keys(svc).slice(0, 15);
            }
          } catch {}
        }

        // Check for background sync
        const disk = di?.get('disk');
        if (disk?.sync) {
          findings.diskSync = {
            methods: Object.keys(disk.sync).filter(k => typeof disk.sync[k] === 'function'),
            props: Object.keys(disk.sync).filter(k => typeof disk.sync[k] !== 'function')
          };
        }

        // Check for draft sharing/team features
        const teamData = di?.get('teamData');
        if (teamData) {
          findings.teamData = {
            methods: Object.keys(teamData).filter(k => typeof teamData[k] === 'function'),
            hasSharedDrafts: Object.keys(teamData).some(k => k.toLowerCase().includes('draft'))
          };
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("Real-time sync investigation:", JSON.stringify(result.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
