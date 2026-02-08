import { connectToSuperhuman, disconnect } from "./src/superhuman-api";
import { sendEmail, getAccountInfo } from "./src/send-api";

async function main() {
  const conn = await connectToSuperhuman(9333);
  if (!conn) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const accountInfo = await getAccountInfo(conn);
  console.log("Account info:", accountInfo);

  const timestamp = new Date().toLocaleTimeString();
  const result = await sendEmail(conn, {
    to: ["eddyhu@gmail.com"],
    subject: `API Send Test ${timestamp}`,
    body: "<p>This email was sent via direct Gmail API call, bypassing the UI entirely!</p><p>If you see this, the server-side send works!</p>",
    isHtml: true,
  });

  console.log("Send result:", result);

  await disconnect(conn);
}

main().catch(console.error);
