
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function cleanupAndDraft() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = "AAQkAGQ3YjA1Zjk1LWMxNjgtNGQ2ZS05ZjhmLTE1OWVjMTJkNGMwZQAQAHKRzrfbUrhOp7nNkTSoDEM=";
          const bodyText = "Hi Tyler, no problem at all. I'll make sure you get credit for attendance on 1/29. Thanks for letting me know!";
          
          const cfc = window.ViewState?._composeFormController;
          
          // Discard ALL existing drafts for this thread
          const draftKeys = Object.keys(cfc).filter(k => k.startsWith('draft'));
          for (const key of draftKeys) {
            const ctrl = cfc[key];
            if (ctrl.state?.draft?.threadId === threadId || ctrl.state?.draft?.to?.some(r => r.email.toLowerCase().includes('htu9sp'))) {
               if (typeof ctrl.discard === 'function') {
                 await ctrl.discard();
               } else if (typeof ctrl._discardDraftAsync === 'function') {
                 await ctrl._discardDraftAsync();
               }
            }
          }
          
          await new Promise(r => setTimeout(r, 1000));

          // Set thread context
          const tree = window.ViewState?.tree;
          if (tree?.set) {
            tree.set(['threadPane', 'threadId'], threadId);
            tree.set(['threadListView', 'threadId'], threadId);
          }
          
          await new Promise(r => setTimeout(r, 500));

          // Open new reply
          const rc = window.ViewState?.regionalCommands;
          let replyCmd = null;
          for (const region of rc) {
            if (region?.commands) {
              replyCmd = region.commands.find(c => c.id === "REPLY_POP_OUT");
              if (replyCmd) break;
            }
          }

          if (replyCmd) {
            replyCmd.action({ preventDefault: () => {}, stopPropagation: () => {} });
          } else {
            return { error: "REPLY_POP_OUT not found" };
          }

          // Wait for compose
          await new Promise(r => setTimeout(r, 2000));

          const newDraftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!newDraftKey) return { error: "New draft controller not found" };

          const ctrl = cfc[newDraftKey];
          const html = "<p>" + bodyText + "</p>";
          
          await ctrl._updateDraft({ body: html });
          
          if (ctrl.state?.draft) {
            ctrl.state.draft.body = html;
          }

          if (typeof ctrl._saveDraftAsync === 'function') {
            await ctrl._saveDraftAsync();
          }

          return {
            success: true,
            draftId: ctrl.state?.draft?.id,
            body: ctrl.state?.draft?.body,
            to: (ctrl.state?.draft?.to || []).map(r => r.email)
          };
        } catch (e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });

  console.log(JSON.stringify(result.result.value, null, 2));
  await disconnect(conn);
}

cleanupAndDraft();
