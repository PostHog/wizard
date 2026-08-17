# anthropic harness

Wraps Anthropic's official [Claude Agent SDK][sdk]
(`@anthropic-ai/claude-agent-sdk`) and drives Claude models through the PostHog
LLM gateway.

[sdk]: https://github.com/anthropics/claude-agent-sdk-typescript

## What it is

A thin adapter over the Claude Agent SDK, which itself wraps a bundled Claude
Code CLI subprocess. When the wizard picks this harness, `initializeAgent` +
`runAgent` in `@lib/agent/agent-interface` build the SDK's `AgentRunConfig`
(system prompt, tools, MCP servers, hooks, model) and drive one query/run.

Both entry points are implemented:

- **`run()`** — linear mode, one agent per program (integration, audit, etc.)
- **`runTask()`** — orchestrator mode, one agent per seed plan + per drained task

## Core characteristics

- **Model transport:** requests go to the PostHog LLM gateway, authed with the
  user's OAuth token (`CLAUDE_CODE_OAUTH_TOKEN` + `ANTHROPIC_BASE_URL`).
  Bedrock fallback via `x-posthog-use-bedrock-fallback: true`.
- **Context window:** 1M-context beta (`context-1m-2025-08-07`) so large
  projects don't overflow during compaction.
- **Custom headers:** wizard flags (`X-POSTHOG-FLAG-*`) and metadata
  (`X-POSTHOG-PROPERTY-*`) piggyback on every gateway request for tracing.
- **Model routing:** `AgentConfig.modelOverride` accepts any gateway model id
  (`DEFAULT_AGENT_MODEL`, `HAIKU_MODEL`, `OPUS_MODEL`, `GPT5_6_TERRA_MODEL`), so
  mechanical work (repo classification, source-map detection) can route to
  `HAIKU_MODEL` while integration work stays on Sonnet.

## Security fence

- **`canUseTool` (L1):** program-scoped allow/deny lists layered on
  `BASE_ALLOWED_TOOLS`. Bash commands allowlisted to install / build /
  typecheck / lint / format only.
- **YARA hooks (L2):** `PreToolUse` scans Bash commands + `PostToolUse` scans
  Read/Write/Edit content for PII, hardcoded keys, prompt injection,
  destructive ops, and PostHog-config violations.
- **wizard_ask overlay guard:** `Write`/`Edit` blocked while an interactive
  question overlay is open (defense in depth against parallel edits).

## Tool surface

| Category | Tools |
|---|---|
| Built-in file ops | `Read`, `Write`, `Edit`, `Grep`, `Glob` |
| Shell | `Bash` (allowlisted install/build/lint commands only) |
| Web | `WebFetch`, `WebSearch` |
| Subagents | `Task` (dispatch nested subagent — same fence inherited) |
| Todo tracking | `TodoWrite` (renders in the TUI todo panel) |
| MCP: PostHog | `dashboard-create`, `insight-create`, `notebooks-create`, HogQL execution, and the rest of the `posthog-wizard` MCP surface |
| MCP: wizard-tools | `wizard_ask`, `load_skill_menu`, `install_skill`, `check_env_keys`, `set_env_values`, plus the orchestrator queue tools (`enqueue_task`, `complete_task`, `read_handoffs`) |
| Additional | Extra program-specific MCP servers passed via `additionalMcpServers` (e.g. Svelte MCP) |
