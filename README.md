# superhuman-cli

CLI and MCP server to control [Superhuman](https://superhuman.com) email client via Chrome DevTools Protocol (CDP).

## Requirements

- [Bun](https://bun.sh) runtime
- Superhuman.app running with remote debugging enabled

## Setup

```bash
# Install dependencies
bun install

# Start Superhuman with CDP enabled
/Applications/Superhuman.app/Contents/MacOS/Superhuman --remote-debugging-port=9333
```

## CLI Usage

```bash
# Check connection status
bun src/cli.ts status

# Create a draft
bun src/cli.ts draft --to user@example.com --subject "Hello" --body "Hi there!"

# Open compose window (keeps it open for editing)
bun src/cli.ts compose --to user@example.com --subject "Meeting"

# Send an email
bun src/cli.ts send --to user@example.com --subject "Quick note" --body "FYI"
```

### Options

| Option | Description |
|--------|-------------|
| `--to <email>` | Recipient email address (required) |
| `--cc <email>` | CC recipient (can be used multiple times) |
| `--bcc <email>` | BCC recipient (can be used multiple times) |
| `--subject <text>` | Email subject |
| `--body <text>` | Email body (plain text, converted to HTML) |
| `--html <text>` | Email body as raw HTML |
| `--port <number>` | CDP port (default: 9333) |

## MCP Server

Run as an MCP server for Claude integration:

```bash
bun src/index.ts --mcp
```

### MCP Tools

- `superhuman_draft` - Create an email draft
- `superhuman_send` - Send an email
- `superhuman_search` - Search the inbox

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "superhuman": {
      "command": "bun",
      "args": ["/path/to/superhuman-cli/src/index.ts", "--mcp"]
    }
  }
}
```

## How It Works

This tool uses Chrome DevTools Protocol (CDP) to connect to Superhuman's Electron renderer process and interact with its internal React state:

- `window.ViewState._composeFormController` - Access compose form controllers
- Draft keys: `draft00c0820cca54b14a` format
- Methods: `setSubject()`, `_updateDraft()`, `_saveDraftAsync()`, `_sendDraft()`

This approach is more reliable than DOM/keyboard automation because it uses Superhuman's internal APIs directly.

## License

MIT
