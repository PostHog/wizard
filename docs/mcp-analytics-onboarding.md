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
dependencies, and symlinked files are excluded. Suggestions recognize the
official SDK constructors, TypeScript FastMCP (including generic constructors),
and Mastra's MCPServer. Recognition does not guarantee that a wrapper supports
direct instrumentation: the agent still verifies its integration path.

The scan reserves up to 500 matches for MCP-named directories and server-named
files, alongside up to 500 general source matches. Both passes are bounded to
six directory levels and read at most 64 KiB per unique file. This keeps
unrelated application code from consuming the entire suggestion budget in large
monorepos. Application packages sort before examples and templates. Test
fixtures and comment-only examples do not become suggested servers. Aliases,
deeper trees, and files beyond these bounds can still require agent discovery.

The wizard also reads up to 500 package/deployment metadata paths. For
JavaScript workspaces, it groups related server files into one application
suggestion using `package.json` executable/start metadata or a Wrangler config,
server/factory usage, and runtime package dependencies. Development-only
dependencies and client-only consumers do not establish server applications.
Package names are shown beside their locations; choosing an application lets the
agent resolve its entry points and follow workspace imports while keeping
changes scoped to that application. Python entry-point suggestions remain
file-based.

Shared libraries help identify their consumers rather than becoming the default
installation target. If only shared code is found, agent discovery finds the
runnable app first. An MCP launcher with no local implementation gets a source
tracing path: the agent checks imports and package metadata, avoids editing
installed dependencies, and explains the source location when it is outside the
checkout. These hints are local heuristics, not proof of runtime support.

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
