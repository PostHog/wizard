# Agent

The agent runs one AI pipeline against a project. It takes resolved data in,
reports through progress events, asks through an answerer you pass, and returns
a result. It never reads a session, a store or a UI.

To call it from code, use `runAgent`. The
[developer interfaces](../../docs/developer-interfaces.md#runagent) cover it.

The [switchboard](runner/switchboard/README.md) picks the sequence, harness,
model and effort for each run. The agent calls models through the PostHog AI
gateway.

## What goes in and out

- **In.** A `RunConfig` with the caller's routing, a `RunInput`, and callbacks
  for progress and questions.
- **Out.** One `RunResult` at the end.
- **Never in.** A session, a store or the UI.

## Where things live

| What                                      | Where                                             |
| ----------------------------------------- | ------------------------------------------------- |
| The entry points                          | [`index.ts`](index.ts) and [`types.ts`](types.ts) |
| The run types: config, input and result   | [`shared/types.ts`](runner/shared/types.ts)       |
| Progress events and the answerer          | [`progress.ts`](progress.ts)                      |
| Sequences, harnesses and route resolution | [`runner`](runner/README.md)                      |
| The wizard tools both harnesses share     | [`tools`](tools), see [Tools](#tools)             |
| The benchmark pipeline                    | [`middleware`](middleware)                        |
| YARA scans of tool calls (Pre/PostToolUse) and of installed skills | [`yara-hooks.ts`](yara-hooks.ts)                  |

Import runtime values from `@agent` and types from `@agent/types`. `@agent`
exports `runAgent`, `RunOutcome` (from `@shared/run-state`, so the hosts read it
without the agent), `AgentSignals`, `WIZARD_TOOL_NAMES`, `DEFAULT_BINDING`,
`scanVerdict`, `scanInstalledSkill` and `streamMcpPrompt`, the MCP tutorial's
prompt stream. `pnpm lint` rejects a deeper import from any other layer, through
ESLint `no-restricted-syntax`. Files inside `src/agent` import each other by
relative path. Nothing enforces this: the agent's project maps `@agent`,
`@agent/types` and `@agent/*` through `tsconfig.no-tui.json`, and its tests use
them. The agent itself may import `@env`, `@shared/*` and `@utils/*`, and
nothing else; see
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Tools

The agent gets two sets of tools on top of its harness's file and shell tools.

### `wizard-tools`

An in-process MCP server with the tools a generic agent lacks. One
implementation in [`tools/tools.ts`](tools/tools.ts) serves both harnesses.
Anthropic mounts it as an MCP server through [`tools/mcp.ts`](tools/mcp.ts), so
its tools are named `mcp__wizard-tools__<tool>`. Pi registers the same tools
natively, in [`harness/pi/tools.ts`](runner/harness/pi/tools.ts).
`WIZARD_TOOL_NAMES` lists the full names.

| Tool | What it does |
| --- | --- |
| `check_env_keys` | Says which env keys the project sets, and in which file. Names only, never values. |
| `set_env_values` | Writes env keys to a `.env` file and makes sure git ignores it. A value can be a secret reference from `wizard_ask`. |
| `detect_package_manager` | Returns the project's package managers and their install and run commands. |
| `load_skill_menu` | Lists the skills in one category of the [skill menu](../shared/README.md#skills). |
| `install_skill` | Installs one skill into `.claude/skills/<id>/`. |
| `audit_seed_checks`, `audit_add_checks`, `audit_resolve_checks` | Write the audit program's checklist. |
| `wizard_ask` | Asks the user structured questions and waits. A sensitive answer comes back as a secret reference. |
| `publish_handoff` | Publishes the run's final markdown report. |
| `enqueue_task`, `complete_task`, `read_handoffs` | Orchestrator runs only. The seed queues tasks. A task reports its handoff and reads the ones before it. |

### PostHog MCP

The agent reaches PostHog through the hosted PostHog MCP server,
`https://mcp.posthog.com/mcp`, or a local one with `--local-mcp`. The server
exposes one `exec` tool. Its `command` takes `tools`, `search <regex>`,
`info <tool>` or `call <tool> <json>`, so one tool reaches every PostHog MCP
tool. It runs with the run's OAuth token.

| Harness | How it connects | The agent calls it |
| --- | --- | --- |
| Anthropic | An HTTP MCP server named `posthog-wizard`, always loaded | `mcp__posthog-wizard__exec` |
| Pi | `pi-mcp-adapter` bridges the same server, in [`harness/pi/mcp.ts`](runner/harness/pi/mcp.ts) | `posthog_exec` |

An orchestrator task can only call it when its frontmatter lists
`posthog_exec` in `allowedTools`.

### Removing tools

A program removes tools with `disallowedTools` on its config, and adds its own
with `allowedTools`. For example, programs that must not stop for the user set
`disallowedTools: [WIZARD_TOOL_NAMES.wizardAsk]`. An orchestrator task does the
same with `allowedTools` and `disallowedTools` in its frontmatter.
