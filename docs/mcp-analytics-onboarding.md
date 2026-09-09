# MCP analytics onboarding

Run `npx @posthog/wizard@latest mcp-analytics` to instrument an existing MCP server.
To connect the PostHog MCP server to a coding agent instead, run
`npx @posthog/wizard@latest mcp add`.

Before authentication, the wizard performs a bounded local scan for JavaScript,
TypeScript, and Python server entry points. Select a suggested file, enter another
directory or entry-point file, or let the agent search the current directory for
a custom server. The quick scan is a suggestion: no matches does not rule out a
supported server. Tests, dependencies, and symlinked files are excluded.

Entering a directory scans that location again. Selecting a file uses its closest
ancestor project directory and asks the agent to verify the selected entry point.
Review the directory and server before confirming. Invalid paths stay on the
selection screen and can be corrected without restarting authentication.

Installation completion does not verify event ingestion. Set the environment
variables in `posthog-mcp-analytics-report.md`, start or redeploy the server, and
invoke a tool that is safe to run. The completion screen links to MCP analytics
in the authenticated project and region so you can check that the call arrived.

Selection telemetry records scan outcomes, candidate counts, selection method,
and whether a file or directory was selected. These new events do not include
local paths or source code.
