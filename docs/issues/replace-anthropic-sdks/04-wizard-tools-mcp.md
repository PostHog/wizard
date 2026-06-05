# 04 — In-process `wizard-tools` hosting without `createSdkMcpServer`

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none (flag at 0%) · **Depends on:** [02](02-harness-agent-loop.md)

## Summary

Host the wizard's own MCP tools inside the harness without the SDK's
`createSdkMcpServer` / `tool()` helpers. Today `wizard-tools.ts` builds an in-process MCP
server (`wizard-tools.ts:1107`) registered into the SDK at `agent-interface.ts:741`. The
harness needs to expose the same tools to the model and dispatch them directly.

## Tools in scope (from `wizard-tools.ts`)

- Infrastructure: `check_env_keys`, `set_env_values`, `detect_package_manager`,
  `load_skill_menu`, `install_skill`
- Audit ledger: `audit_seed_checks`, `audit_add_checks`, `audit_resolve_checks`
- Interactive: `wizard_ask` (question overlay)

These are pure handlers wrapped in `sdk.tool(name, description, zodSchema, handler)`
(`wizard-tools.ts:510`). The handlers themselves don't depend on the SDK — only the
registration wrapper does.

## Scope

1. Refactor `wizard-tools.ts` so the handlers and their Zod schemas are exported
   independently of `sdk.tool` / `sdk.createSdkMcpServer`.
2. Add a harness-side adapter that registers these handlers into the PR 03 tool registry
   under the same tool names (`WIZARD_TOOL_NAMES`), so the model sees an identical tool
   surface whether it runs under the SDK or the harness.
3. Keep `SdkRunner` using `createSdkMcpServer` over the *same* exported handlers — no
   duplicated handler logic, one source of truth.
4. Implement `ListMcpResourcesTool` (stubbed in PR 03) against this registry.

## Acceptance criteria

- [ ] `check_env_keys` / `set_env_values` operate on `.env` identically under both runners
      (this is the secrets boundary — must not regress).
- [ ] `wizard_ask` renders the same TUI overlay under the harness.
- [ ] `install_skill` / `load_skill_menu` resolve and install skills identically.
- [ ] Handler logic is shared between `SdkRunner` and `HarnessRunner` (no fork).
- [ ] Flag remains **0% harness**.

## Files

- `src/lib/wizard-tools.ts` (split handlers/schemas from SDK registration)
- `src/lib/agent/runner/tools/wizard-tools-adapter.ts` (new)
- `src/lib/agent/runner/sdk-runner.ts` (register shared handlers via `createSdkMcpServer`)
