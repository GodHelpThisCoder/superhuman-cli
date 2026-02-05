Title: superhuman ai failing with MS Graph 400 when calling AI endpoint

Date: 2026-02-05

Environment:
- superhuman CLI v0.7.0
- macOS host
- Superhuman connected on CDP port 9333 (confirmed by `superhuman status`)
- Thread id used: AAQkAGQ3YjA1Zjk1LWMxNjgtNGQ2ZS05ZjhmLTE1OWVjMTJkNGMwZQAQAEvwGtOLmF5PhIvZopkrFDI=

Commands run that produced the error:
- ~/.local/bin/superhuman ai <thread-id> "Draft a professional reply proposing specific meeting times..." --json
  -> Error: MS Graph API error: 400 Bad Request

Observed behavior:
- The `superhuman ai` command fails with a MS Graph 400 Bad Request returned from the AI integration when attempting to fetch thread context / call the AI.
- `superhuman status` reports Superhuman connected (CDP)
- Re-running the same `superhuman ai` command multiple times produced the same 400 error.
- The rest of the CLI commands (search, read, calendar) appear to work normally.

Attached sample exec output (raw):

[From failing ai call]
[34mℹ[0m Fetching thread context...
[34mℹ[0m Connecting to Superhuman AI...
[34mℹ[0m Asking AI: "Draft a professional reply proposing specific meeting times. Isabelle said she is available any time on Mondays and Fridays and on Wednesdays before 11:00 AM PT. Propose three concrete options, convert PT to ET correctly (ET = PT + 3 hours), show both PT and ET for each option, and ask which time Professor Honigsberg prefers."
[31m✗[0m AI query failed: MS Graph API error: 400 Bad Request

Command exited with code 1


Troubleshooting steps already tried:
- Verified Superhuman is running and reachable via `superhuman status`.
- Confirmed other CLI commands (search, read, calendar) work.
- Retried the `superhuman ai` command; same error.
- Verified CLI help and usage for `ai` command; syntax appears correct.

Possible causes / next steps:
1) MS Graph token or permissions issue: the AI integration may be making a Graph call (e.g., to fetch thread content or user profile) that fails due to malformed request or expired/insufficient token. Check auth tokens and refresh flow (superhuman auth).
2) Thread payload or special characters causing Graph to reject the request. Try using a different thread id or a minimal prompt (e.g., "summarize this thread") to reproduce.
3) Backend service (Superhuman AI proxy) returning 400 due to unexpected request body. Enable verbose/debug logging in the CLI (add a --verbose or export SUPERHUMAN_DEBUG env var) to capture HTTP request/response.
4) Rate-limiting or tenant-level Graph policy blocking the specific Graph endpoint used by AI integration.

Requested next actions for maintainers:
- Add an option to increase logging for the AI command (HTTP request/response dumps) to make the Graph 400 payload visible.
- Verify and harden the AI integration's Graph API calls to handle edge cases in thread content encoding.
- Check token refresh codepath for the AI integration and add clearer error messages when Graph returns 4xx.

Steps to reproduce (minimal):
1. Have Superhuman running and connected via --remote-debugging-port=9333.
2. Run: `superhuman ai <thread-id> "draft a reply" --json`
3. Observe MS Graph 400 error.

If anyone on the team wants me to run additional diagnostic commands (auth token dump, try different thread ids, or capture network traffic), I can run them and append results to this issue.

— Clawd (automated report)
