---
type: mcp-analytics
flow: integration-v2
label: Add MCP analytics
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: []
allowedTools: [Read, Write, Edit, Glob, Grep, load_skill_menu, install_skill]
disallowedTools: [enqueue_task]
dependsOn: [install, init, identify]
optional: true
---

## Goal

Add PostHog MCP analytics to the MCP server this project defines, so every tool
call it handles is captured as `$mcp_tool_call`. The wizard queues this task
only when its scan found MCP server code, and the detected facts name the paths
it found. If no fact names an MCP server, complete as `not needed` and make no
changes.

Treat those paths as leads to one server, not as a list of servers: a stdio
entry and an HTTP entry, or a dispatcher split across files, show up as several
paths. Skip example and template paths. Instrument one server. Only when the
paths are servers deployed separately, instrument the one the project's start
script or deploy config runs, or else the first one listed, and name the others
in your handoff.

Load the `mcp-analytics` skill menu and install the `python` variant for a
Python server and `all` for any other. Follow that skill's steps for the
language and server style it identifies. Where the skill says to emit
`[ABORT]`, complete as `not needed` with that reason instead: one server you
cannot instrument must not end the rest of this run. Make only additive
changes, and never change what a tool does.

Build on what earlier tasks set up. Where `init` created a server client in the
same process as the MCP server, pass it to the SDK, or on a custom dispatcher swap
it for `PostHogMCP` in place, and never create a second one. Where it did not, such
as a browser client or a client in another package, create one server client in
the MCP server's package with `new PostHog(token, { host,
enableExceptionAutocapture: true })`, because the `error-tracking` task stays with
the app. It has to be on that constructor to capture uncaught crashes: the option
of the same name on `instrument()` only covers failed tool calls. Where the skill resolves a `distinctId`, take it
from where the identify handoff says identity lives, and omit it rather than
invent one. If that client throws when its config is missing, change the throw
to a warning on stderr: analytics must never stop the server from booting.

This is the instrumentation part of a larger integration. Instead of the
skill's install and verify steps, name the packages in your handoff for review
to install, and list each one in the handoff's `packages` field, and say which
package directory they belong in. Read the skill's install step for this, without
running its commands: take each package, minimum version, feature and toolchain
requirement from there. On TypeScript, name `@posthog/mcp@latest` saved exact; the
skill's minimum is only the oldest version that works. Do not edit dependency
manifests or write a version number you invented. If the project already declares
one of these packages, or a dependency the skill sets a minimum for such as `rmcp`,
with a pin or cap that can't reach its minimum, say so in your handoff. A range that
can reach it, such as `^1.12.0` for a 1.26.0 minimum, is fine. Do not run the server.

Skip the skill's credentials step. Use the project and host the wizard supplied
and the env names from upstream handoffs, not the skill's
`POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`. The exception is a separately run server
when those names carry a browser prefix like `NEXT_PUBLIC_` or `VITE_`: there use
`POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`, in that server's own env file. Inspect
and write environment files only through `check_env_keys` and `set_env_values`. Do not request credentials
or select a different project. On a STDIO server, say in your handoff that the
user sets these variables in the `env` block of their MCP client's server
config, and that the env file is only where to copy the values from: the client
starts the server, and nothing there reads the file.

## How you know you succeeded

One server is instrumented through the path the skill selected, or the handoff
gives the skill's reason this task was not needed. The handoff names the server
and path, the changed files, the packages for review with their minimums and
features, the env variable names (never values), the shutdown or flush change,
and a tool that is safe to call to produce a `$mcp_tool_call`. Say plainly
whether the server now records every tool call, so `capture` knows which events
to skip. Name any other servers the paths pointed to, so the report can point
the user to `wizard mcp-analytics` for them. For a Ruby or Rust server, say the
SDK is experimental and not officially supported. Describe delivery as
unverified unless this run observed it, and do not write
`posthog-mcp-analytics-report.md` or any other report.
