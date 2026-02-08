
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function draftAndVerify() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const cfc = window.ViewState?._composeFormController;
          if (!cfc) return { error: "ViewState._composeFormController not found" };
          
          const threadId = "AAQkAGQ3YjA1Zjk1LWMxNjgtNGQ2ZS05ZjhmLTE1OWVjMTJkNGMwZQAQAHKRzrfbUrhOp7nNkTSoDEM=";
          const body = "Hi Tyler, no problem at all. I'll make sure you get credit for attendance on 1/29. Thanks for letting me know!";
          
          // Try to use a native command to open reply
          const tree = window.ViewState?.tree;
          if (tree?.set) {
            tree.set(['threadPane', 'threadId'], threadId);
            tree.set(['threadListView', 'threadId'], threadId);
          }

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
            return { error: "REPLY_POP_OUT command not found" };
          }

          // Wait for compose to open
          await new Promise(r => setTimeout(r, 2000));

          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "Draft key not found after reply" };

          const ctrl = cfc[draftKey];
          
          // Set the body
          const html = "<p>" + body + "</p>";
          await ctrl._updateDraft({ body: html });
          
          // Explicitly set text content if possible or trigger a sync
          if (ctrl.state?.draft) {
             ctrl.state.draft.body = html;
          }

          // Force save
          await ctrl._saveDraftAsync();
          
          // Return state for verification
          const draft = ctrl.state.draft;
          return {
            success: true,
            draftId: draft.id,
            subject: draft.subject,
            body: draft.body,
            to: (draft.to || []).map(r => r.email)
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

draftAndVerify();
