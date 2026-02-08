
import { connectToSuperhuman, disconnect } from "./src/superhuman-api";

async function draftReplyNoSend() {
  const conn = await connectToSuperhuman(9333, true);
  if (!conn) return;

  const result = await conn.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const threadId = "AAQkAGQ3YjA1Zjk1LWMxNjgtNGQ2ZS05ZjhmLTE1OWVjMTJkNGMwZQAQAHKRzrfbUrhOp7nNkTSoDEM=";
          const bodyText = "Hi Tyler, no problem at all. I'll make sure you get credit for attendance on 1/29. Thanks for letting me know!";
          
          const tree = window.ViewState?.tree;
          if (tree?.set) {
            tree.set(['threadPane', 'threadId'], threadId);
            tree.set(['threadListView', 'threadId'], threadId);
          }
          
          await new Promise(r => setTimeout(r, 500));

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

          const cfc = window.ViewState?._composeFormController;
          const draftKey = Object.keys(cfc).find(k => k.startsWith('draft'));
          if (!draftKey) return { error: "Draft controller not found" };

          const ctrl = cfc[draftKey];
          const html = "<p>" + bodyText + "</p>";
          
          // Use multiple methods to ensure the body is set
          if (typeof ctrl.setBody === 'function') {
            await ctrl.setBody(html);
          } else if (typeof ctrl._updateDraft === 'function') {
            await ctrl._updateDraft({ body: html });
          }
          
          // Double check the internal state
          if (ctrl.state?.draft) {
            ctrl.state.draft.body = html;
          }

          // Sync with server
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

draftReplyNoSend();
