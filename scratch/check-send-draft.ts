import { connectToSuperhuman, disconnect } from "../src/superhuman-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    return;
  }

  const { Runtime } = conn;

  // Check what _sendDraft actually does - look at its implementation
  const result = await Runtime.evaluate({
    expression: `
      (() => {
        const findings = {};

        // Find a compose controller prototype
        const cfc = window.ViewState?._composeFormController;
        if (!cfc) return { error: "No compose controller" };

        // Get the constructor/prototype
        const ComposeFormController = Object.values(cfc)[0]?.constructor;
        if (!ComposeFormController) {
          // Try to find it another way
          const ga = window.GoogleAccount;

          // Check gmail service for send methods
          const gmail = ga?.di?.get('gmail');
          if (gmail) {
            findings.gmailMethods = Object.keys(gmail).filter(k =>
              typeof gmail[k] === 'function' &&
              (k.includes('send') || k.includes('draft') || k.includes('message'))
            );
          }

          // Check msgraph for Outlook
          const msgraph = ga?.di?.get('msgraph');
          if (msgraph) {
            findings.msgraphMethods = Object.keys(msgraph).filter(k =>
              typeof msgraph[k] === 'function' &&
              (k.includes('send') || k.includes('draft') || k.includes('message'))
            );
          }

          // Check threads service
          const threads = ga?.di?.get('threads');
          if (threads) {
            findings.threadsSendMethods = Object.keys(threads).filter(k =>
              typeof threads[k] === 'function' &&
              (k.includes('send') || k.includes('create'))
            );
          }

          return findings;
        }

        // Check prototype methods related to sending
        const proto = ComposeFormController.prototype;
        if (proto) {
          findings.protoSendMethods = Object.getOwnPropertyNames(proto).filter(k =>
            k.includes('send') || k.includes('Send')
          );
          findings.protoDraftMethods = Object.getOwnPropertyNames(proto).filter(k =>
            k.includes('draft') || k.includes('Draft')
          );
        }

        return findings;
      })()
    `,
    returnByValue: true,
  });

  console.log("Send/Draft methods:", JSON.stringify(result.result.value, null, 2));

  // Now check what the gmail service's send actually does
  const gmailResult = await Runtime.evaluate({
    expression: `
      (() => {
        const ga = window.GoogleAccount;
        const gmail = ga?.di?.get('gmail');

        if (!gmail) return { error: "No gmail service" };

        // Check for _postAsync which is used for API calls
        const methods = {};

        const allMethods = Object.keys(gmail).filter(k => typeof gmail[k] === 'function');
        methods.all = allMethods;

        // Check what endpoints gmail service knows about
        if (gmail._endpoints) {
          methods.endpoints = Object.keys(gmail._endpoints);
        }

        return methods;
      })()
    `,
    returnByValue: true,
  });

  console.log("\nGmail service methods:", JSON.stringify(gmailResult.result.value, null, 2));

  await disconnect(conn);
}

main().catch(console.error);
