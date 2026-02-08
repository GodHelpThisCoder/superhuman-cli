import { connectToSuperhuman, disconnect, openCompose } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // First, open a compose window to have an active draft
  console.log("Opening compose window...");
  const draftKey = await openCompose(conn);
  console.log("Draft key:", draftKey);

  // Wait a moment for initialization
  await new Promise(r => setTimeout(r, 1000));

  // Now explore the disk services
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const di = ga?.di;

        const findings = {};

        // Check disk service
        try {
          const disk = di.get('disk');
          if (disk) {
            findings.disk = {
              type: typeof disk,
              methods: Object.keys(disk).filter(k => typeof disk[k] === 'function').slice(0, 30),
              properties: Object.keys(disk).filter(k => typeof disk[k] !== 'function').slice(0, 20)
            };
          }
        } catch (e) {
          findings.disk = { error: e.message };
        }

        // Check backend service - this might handle draft syncing
        try {
          const backend = di.get('backend');
          if (backend) {
            findings.backend = {
              type: typeof backend,
              methods: Object.keys(backend).filter(k => typeof backend[k] === 'function').slice(0, 30),
              hasPostDraft: typeof backend.postDraft === 'function',
              hasSaveDraft: typeof backend.saveDraft === 'function'
            };
          }
        } catch (e) {
          findings.backend = { error: e.message };
        }

        // Check the compose controller for the active draft
        const cfc = window.ViewState?._composeFormController;
        if (cfc) {
          const keys = Object.keys(cfc);
          if (keys.length > 0) {
            const ctrl = cfc[keys[0]];

            // Look at the _saveDraftAsync function source
            const saveFunc = ctrl._saveDraftAsync;
            if (saveFunc) {
              findings.saveDraftAsyncType = typeof saveFunc;
              // Try to get function details
              findings.saveDraftAsyncLength = saveFunc.length;
            }

            // Check what the draft object looks like
            const draft = ctrl?.state?.draft;
            if (draft) {
              findings.draftStructure = {
                keys: Object.keys(draft).slice(0, 30),
                id: draft.id,
                hasLocalId: !!draft.localId,
                hasServerId: !!draft.serverId,
                syncStatus: draft.syncStatus
              };
            }

            // Check for any sync-related methods
            findings.controllerSyncMethods = Object.keys(ctrl)
              .filter(k => k.toLowerCase().includes('sync') || k.toLowerCase().includes('save'))
              .slice(0, 20);
          }
        }

        // Check threads service for draft handling
        try {
          const threads = di.get('threads');
          if (threads) {
            const threadMethods = Object.keys(threads).filter(k => typeof threads[k] === 'function');
            findings.threadsDraftMethods = threadMethods.filter(m =>
              m.toLowerCase().includes('draft')
            );
            findings.threadsSaveMethods = threadMethods.filter(m =>
              m.toLowerCase().includes('save') || m.toLowerCase().includes('create')
            );
          }
        } catch (e) {
          findings.threads = { error: e.message };
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("Disk/Backend investigation:", JSON.stringify(result.result.value, null, 2));

  // Close compose
  await Runtime.evaluate({ expression: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))` });

  await disconnect(conn);
}

main().catch(console.error);
