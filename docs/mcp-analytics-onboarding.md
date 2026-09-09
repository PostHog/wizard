# MCP analytics onboarding

Run `npx @posthog/wizard@latest mcp-analytics` to instrument an existing MCP
server. To connect the PostHog MCP server to a coding agent instead, run
`npx @posthog/wizard@latest mcp add`.

Before authentication, the wizard performs a bounded local scan for JavaScript,
TypeScript, and Python server entry points. A single match is preselected:
choose "Set up MCP analytics" to continue. Multiple matches offer a choice. When
the scan is inconclusive, the default action lets the agent find the server and
set up analytics in the current directory. "Choose another location" is an
optional escape hatch for a different directory or entry-point file. The quick
scan is a suggestion: no matches does not rule out a supported server. Tests,
dependencies, and symlinked files are excluded. Python suggestions include the
official SDK v2 `MCPServer` constructor alongside the older `FastMCP` and
low-level `Server` constructors.

Entering a directory scans that location again. Selecting a file uses its
closest ancestor project directory and asks the agent to verify the selected
entry point. Manually selected files and ambiguous matches get a review before
confirming; a single suggestion and automatic discovery need no second
confirmation. Invalid paths stay on the selection screen and can be corrected
without restarting authentication.

Installation completion does not verify event ingestion. Set the environment
variables in `posthog-mcp-analytics-report.md`, start or redeploy the server,
and invoke a tool that is safe to run. The completion screen links to MCP
analytics in the authenticated project and region so you can check that the call
arrived.

Selection telemetry records scan outcomes, candidate counts, selection method,
and whether a file or directory was selected. These new events do not include
local paths or source code.
