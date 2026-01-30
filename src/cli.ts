#!/usr/bin/env bun
/**
 * Superhuman CLI
 *
 * Command-line interface for composing and sending emails via Superhuman.
 *
 * Usage:
 *   superhuman compose --to <email> --subject <subject> --body <body>
 *   superhuman send --to <email> --subject <subject> --body <body>
 *   superhuman draft --to <email> --subject <subject> --body <body>
 *   superhuman status
 */

import {
  connectToSuperhuman,
  openCompose,
  getDraftState,
  setSubject,
  addRecipient,
  setBody,
  saveDraft,
  sendDraft,
  closeCompose,
  disconnect,
  textToHtml,
  type SuperhumanConnection,
} from "./superhuman-api";

const VERSION = "0.1.0";
const CDP_PORT = 9333;

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string) {
  console.log(message);
}

function success(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string) {
  console.error(`${colors.red}✗${colors.reset} ${message}`);
}

function info(message: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}

function printHelp() {
  console.log(`
${colors.bold}Superhuman CLI${colors.reset} v${VERSION}

${colors.bold}USAGE${colors.reset}
  superhuman <command> [options]

${colors.bold}COMMANDS${colors.reset}
  ${colors.cyan}compose${colors.reset}    Open compose window and fill in email (keeps window open)
  ${colors.cyan}draft${colors.reset}      Create and save a draft
  ${colors.cyan}send${colors.reset}       Compose and send an email immediately
  ${colors.cyan}status${colors.reset}     Check Superhuman connection status
  ${colors.cyan}help${colors.reset}       Show this help message

${colors.bold}OPTIONS${colors.reset}
  --to <email>       Recipient email address (required for compose/draft/send)
  --cc <email>       CC recipient (can be used multiple times)
  --bcc <email>      BCC recipient (can be used multiple times)
  --subject <text>   Email subject
  --body <text>      Email body (plain text, converted to HTML)
  --html <text>      Email body as HTML
  --port <number>    CDP port (default: ${CDP_PORT})

${colors.bold}EXAMPLES${colors.reset}
  ${colors.dim}# Create a draft${colors.reset}
  superhuman draft --to user@example.com --subject "Hello" --body "Hi there!"

  ${colors.dim}# Open compose window with pre-filled content${colors.reset}
  superhuman compose --to user@example.com --subject "Meeting"

  ${colors.dim}# Send an email immediately${colors.reset}
  superhuman send --to user@example.com --subject "Quick note" --body "FYI"

${colors.bold}REQUIREMENTS${colors.reset}
  Superhuman must be running with remote debugging enabled:
  ${colors.dim}/Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=${CDP_PORT}${colors.reset}
`);
}

interface CliOptions {
  command: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html: string;
  port: number;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: "",
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
    html: "",
    port: CDP_PORT,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];

      switch (key) {
        case "to":
          options.to.push(value);
          i += 2;
          break;
        case "cc":
          options.cc.push(value);
          i += 2;
          break;
        case "bcc":
          options.bcc.push(value);
          i += 2;
          break;
        case "subject":
          options.subject = value;
          i += 2;
          break;
        case "body":
          options.body = value;
          i += 2;
          break;
        case "html":
          options.html = value;
          i += 2;
          break;
        case "port":
          options.port = parseInt(value, 10);
          i += 2;
          break;
        case "help":
          options.command = "help";
          i += 1;
          break;
        default:
          error(`Unknown option: ${arg}`);
          process.exit(1);
      }
    } else if (!options.command) {
      options.command = arg;
      i += 1;
    } else {
      error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

async function checkConnection(port: number): Promise<SuperhumanConnection | null> {
  try {
    const conn = await connectToSuperhuman(port);
    if (!conn) {
      error("Could not connect to Superhuman");
      info(`Make sure Superhuman is running with: --remote-debugging-port=${port}`);
      return null;
    }
    return conn;
  } catch (e) {
    error(`Connection failed: ${(e as Error).message}`);
    info(`Make sure Superhuman is running with: --remote-debugging-port=${port}`);
    return null;
  }
}

async function cmdStatus(options: CliOptions) {
  info(`Checking connection to Superhuman on port ${options.port}...`);

  const conn = await checkConnection(options.port);
  if (!conn) {
    process.exit(1);
  }

  success("Connected to Superhuman");

  // Get current state
  const state = await getDraftState(conn);
  if (state) {
    log(`\n${colors.bold}Current compose state:${colors.reset}`);
    log(`  Draft ID: ${state.id}`);
    log(`  From: ${state.from}`);
    log(`  To: ${state.to.join(", ") || "(none)"}`);
    log(`  Subject: ${state.subject || "(none)"}`);
    log(`  Dirty: ${state.isDirty}`);
  } else {
    log("\nNo active compose window");
  }

  await disconnect(conn);
}

async function cmdCompose(options: CliOptions, keepOpen = true) {
  if (options.to.length === 0) {
    error("At least one recipient is required (--to)");
    process.exit(1);
  }

  const conn = await checkConnection(options.port);
  if (!conn) {
    process.exit(1);
  }

  info("Opening compose window...");
  const draftKey = await openCompose(conn);
  if (!draftKey) {
    error("Failed to open compose window");
    await disconnect(conn);
    process.exit(1);
  }
  success(`Compose opened (${draftKey})`);

  // Add recipients
  for (const email of options.to) {
    info(`Adding recipient: ${email}`);
    const added = await addRecipient(conn, email);
    if (added) {
      success(`Added: ${email}`);
    } else {
      error(`Failed to add: ${email}`);
    }
  }

  // Set subject
  if (options.subject) {
    info(`Setting subject: ${options.subject}`);
    await setSubject(conn, options.subject);
    success("Subject set");
  }

  // Set body
  const bodyContent = options.html || options.body;
  if (bodyContent) {
    info("Setting body...");
    await setBody(conn, textToHtml(bodyContent));
    success("Body set");
  }

  // Get final state
  const state = await getDraftState(conn);
  if (state) {
    log(`\n${colors.bold}Draft:${colors.reset}`);
    log(`  To: ${state.to.join(", ")}`);
    log(`  Subject: ${state.subject}`);
    log(`  Body: ${state.body.substring(0, 100)}${state.body.length > 100 ? "..." : ""}`);
  }

  if (!keepOpen) {
    await closeCompose(conn);
  }

  await disconnect(conn);
  return state;
}

async function cmdDraft(options: CliOptions) {
  const state = await cmdCompose(options, true);

  if (!state) {
    process.exit(1);
  }

  // Reconnect to save
  const conn = await checkConnection(options.port);
  if (!conn) {
    process.exit(1);
  }

  info("Saving draft...");
  await saveDraft(conn);
  success("Draft saved");

  await disconnect(conn);
}

async function cmdSend(options: CliOptions) {
  if (options.to.length === 0) {
    error("At least one recipient is required (--to)");
    process.exit(1);
  }

  const conn = await checkConnection(options.port);
  if (!conn) {
    process.exit(1);
  }

  info("Opening compose window...");
  const draftKey = await openCompose(conn);
  if (!draftKey) {
    error("Failed to open compose window");
    await disconnect(conn);
    process.exit(1);
  }

  // Add recipients
  for (const email of options.to) {
    await addRecipient(conn, email);
  }

  // Set subject
  if (options.subject) {
    await setSubject(conn, options.subject);
  }

  // Set body
  const bodyContent = options.html || options.body;
  if (bodyContent) {
    await setBody(conn, textToHtml(bodyContent));
  }

  // Send the email
  info("Sending email...");
  const sent = await sendDraft(conn);

  if (sent) {
    success("Email sent!");
  } else {
    error("Failed to send email");
  }

  await disconnect(conn);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(args);

  switch (options.command) {
    case "help":
    case "":
      printHelp();
      break;

    case "status":
      await cmdStatus(options);
      break;

    case "compose":
      await cmdCompose(options, true);
      log(`\n${colors.dim}Compose window left open for editing${colors.reset}`);
      break;

    case "draft":
      await cmdDraft(options);
      break;

    case "send":
      await cmdSend(options);
      break;

    default:
      error(`Unknown command: ${options.command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  error(`Fatal error: ${e.message}`);
  process.exit(1);
});
