# 05 — Security parity: YARA Pre/PostToolUse + `canUseTool`

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none (flag at 0%) · **Depends on:** [03](03-builtin-tools.md), [04](04-wizard-tools-mcp.md)

## Summary

Port the wizard's entire security boundary into the harness loop. This is the
**highest-risk PR** in the epic: the YARA hooks and the `canUseTool` permission gate are
the only things standing between an agent and a destructive or exfiltrating action. The
harness must enforce them identically — and provably so — before any user is routed to it.

## What exists today (SDK path)

Wired into `sdk.query()` at `agent-interface.ts:1093-1107`:

- **`PreToolUse`** — `createPreToolUseYaraHooks()` (`yara-hooks.ts:191`): scans Bash
  commands before execution.
- **`PostToolUse`** — `createPostToolUseYaraHooks()` (`yara-hooks.ts:249`): three matchers
  — Write/Edit content, Read/Grep content (prompt-injection scan), and Bash skill-install
  scans.
- **`Stop`** — `createStopHook(...)` (`agent-interface.ts:1099`, 30s timeout).
- **`canUseTool`** — `wizardCanUseTool()` (`agent-interface.ts:524`, registered at `:1063`):
  enforces env-file blocking, shell-operator blocking, and the `disallowedTools` list.
  Note: this is the **only** mechanism enforcing `disallowedTools` for MCP/subagent tool
  calls, since the SDK does not propagate `disallowedTools` to dispatched subagents.

YARA rules themselves live in the **warlock** sibling repo; the wizard only wires the
scanner. That stays unchanged — this PR re-invokes the same scanner from the harness.

## Scope

1. Define harness hook points that fire at the same moments: **before** a tool handler
   runs (Pre) and **after** it returns (Post), plus a Stop hook.
2. Route `Bash` inputs through `createPreToolUseYaraHooks()`; route Write/Edit/Read/Grep
   and skill-install through `createPostToolUseYaraHooks()` — reuse the exact functions
   from `yara-hooks.ts`, do not reimplement.
3. Call `wizardCanUseTool()` (`agent-interface.ts:524`) before every tool dispatch in the
   harness, including subagent-dispatched tools (PR 06) — closing the gap the SDK left.
4. Match the block/allow/ask outcomes and the user-facing messaging exactly.

## Acceptance criteria

- [ ] A corpus of known-bad inputs (destructive Bash, secret writes, prompt-injection in
      read content) is **blocked under the harness**, asserted by tests.
- [ ] `.env` writes are blocked outside the `set_env_values` tool under the harness.
- [ ] Shell-operator and `disallowedTools` enforcement matches the SDK path.
- [ ] Subagent-dispatched tool calls are gated by `canUseTool` (parity gap closed).
- [ ] Stop hook fires with the same timeout behavior.
- [ ] Flag remains **0% harness** — but this PR is the precondition for PR 07.

## Files

- `src/lib/yara-hooks.ts` (reuse; export shapes if needed)
- `src/lib/agent/runner/harness-runner.ts` (hook invocation points)
- `src/lib/agent/runner/security.ts` (new — adapter calling `wizardCanUseTool` + YARA)

## Risk note

No user should be routed to the harness (PR 07) until this PR's blocked-action corpus is
green. Treat the parity tests here as release-gating.
