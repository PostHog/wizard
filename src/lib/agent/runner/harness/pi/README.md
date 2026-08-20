# pi harness

Wraps pi.dev's [pi-coding-agent SDK][sdk] (`@earendil-works/pi-coding-agent`)
and drives Claude (via the PostHog LLM gateway) or any other provider registered
on pi's `ModelRegistry`.

[sdk]: https://www.npmjs.com/package/@earendil-works/pi-coding-agent

## What it is

pi.dev's coding-agent library is a self-contained agent runtime — its own
resource loader, extension system, tool definition surface (`defineTool` with
`typebox` schemas), and MCP adapter (`pi-mcp-adapter`, loaded via `jiti`).
Unlike the Anthropic harness (which relies on Claude Code CLI's built-ins), pi's
runtime is composed explicitly from parts the wizard supplies.

Entry points:

- **`run()`** — linear mode, one agent per program.
- **`runTask()`** — **not implemented yet.** Orchestrator mode currently throws
  with a clear impl-gap error when this harness is picked; the fix is wrapping
  pi's `createAgentSession` in a task-shaped call.

## Core characteristics

- **Model transport:** the PostHog LLM gateway is registered as an
  `anthropic-messages` provider on pi's in-memory `ModelRegistry`, authed
  bearer-style with the user's OAuth token. Same Bedrock fallback +
  wizard-flag/metadata headers as the anthropic path. OpenAI-class models (e.g.
  `GPT5_6_TERRA_MODEL`) route to `/v1/chat/completions` via `openai-completions`
  shape automatically.
- **Context window:** 1M-context beta enabled
  (`anthropic-beta: context-1m-2025-08-07`) — otherwise runs at 200k and
  compaction fails on larger projects.
- **Env-scrubbed subprocess isolation:** every `bash` child gets a scrubbed env
  holding only `PATH`/`HOME`/proxy/locale keys — no secrets
  (`POSTHOG_PERSONAL_API_KEY`, `ANTHROPIC_*`, `AWS_*`) ever reach an
  `npm install`. Passed via `spawnHook`.
- **Skills/context lockdown:** `noExtensions`, `noSkills`, `noContextFiles`,
  `noPromptTemplates`, `noThemes` all set — the run is hermetic; the target
  project can't inject its own extensions or prompt templates.
- **Live-loaded MCP adapter:** the PostHog MCP (`pi-mcp-adapter`) is
  `jiti`-loaded and pre-warmed. In CLI mode the server exposes a single `exec`
  tool, so the whole roster registers as `directTools` (`directTools: true`) and
  the proxy stays disabled to keep the context lean.

## Security fence

pi has no built-in permission layer, so the wizard installs one via an
extension:

- **`tool_call` hook** (fail-closed) reuses the anthropic path's
  `wizardCanUseTool` (bash allowlist, `.env` fencing) and YARA
  `PreToolUse`/`PostToolUse` scans on every tool call — built-in and custom.
  Tool-name translation (`bash`/`read`/`write`/`edit`/`grep` → claude-cased)
  keeps a single policy source.
- **`tool_result` hook** post-scans read/bash output; a critical YARA hit
  latches the `criticalViolation` flag → every subsequent tool call blocked, run
  terminates as a YARA violation.
- **Runaway guard:** `MAX_TOOL_CALLS = 250` per session; child subagents share
  the parent's counter so the cap can't be escaped by recursion.

## Tool surface

| Category            | Tools                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in file ops   | `read` (parallel), `edit` (sequential), `write` (sequential) — re-registered explicitly because `noTools: 'builtin'` disables pi's defaults                                                                                                                                                             |
| Native exploration  | `ls`, `find`, `grep` — parallel, so batched exploration turns run at once                                                                                                                                                                                                                               |
| Shell               | `bash` — env-scrubbed spawn hook, allowlisted commands only (parity with the anthropic path)                                                                                                                                                                                                            |
| Wizard capabilities | `load_skill_menu`, `install_skill`, `check_env_keys`, `set_env_values` — `defineTool`-based mirrors of the wizard-tools MCP so the shared prompt is unchanged                                                                                                                                           |
| Task/todo           | `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList` — mutations push to `getUI().syncTodos` so the TUI todo panel matches the anthropic path                                                                                                                                                              |
| Subagent            | `dispatch_agent` — nested `createAgentSession` with the SAME security extension inherited, a read-only toolset (`read`/`grep`/`find`/`ls` + env-scrubbed bash), and no `dispatch_agent` of its own. Depth hard-capped at 1.                                                                             |
| MCP: PostHog        | `posthog_exec` — the single CLI-mode tool, registered directly via the warm-connected adapter (`directTools: true`). Its `command` string carries the grammar (`tools`/`search`/`info`/`call`); the dashboard step drives `call dashboard-create {…}` → `call insight-create {…}`. Proxy tool disabled. |

## Runtime steering

Because pi doesn't have Claude Code's built-in guidance, the wizard appends a
long `PI_RUNTIME_NOTES` block to the shared commandments — batching rules, "use
`ls`/`find`/`grep` not `bash ls`", "don't retry blocked commands", "call
`load_skill_menu` once", "no literal PostHog URLs in source", and the
`posthog_exec` command grammar (`info` before `call`). These close the
anti-spiral gaps that showed up in profiling before they became prompt
engineering.

The adapter never surfaces the MCP server's `instructions` payload, so the
active project (name/id, host, region — held in the bootstrap result) rides into
the system prompt as a `## PostHog project` block alongside the notes.
