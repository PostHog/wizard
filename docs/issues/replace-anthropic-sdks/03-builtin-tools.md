# 03 — Built-in tool implementations

**Epic:** [Replace Anthropic agent SDKs](EPIC.md) · **Behavior change:** none (flag at 0%) · **Depends on:** [02](02-harness-agent-loop.md)

## Summary

Implement the built-in tools the SDK provides via its `claude_code` preset, so the
harness loop can actually edit code. This is the heaviest PR in the epic: today these
come "for free" from the bundled `cli.js` and are referenced only by name in
`BASE_ALLOWED_TOOLS` (`agent-interface.ts:1356`).

## Tools to implement

From `BASE_ALLOWED_TOOLS` (`agent-interface.ts:1356`): `Read`, `Write`, `Edit`, `Glob`,
`Grep`, `Bash`, plus the task tools `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`,
and `ListMcpResourcesTool`. (`Task` *dispatch* — spawning subagents — is PR 06.)

Each tool needs: a JSON-schema/Zod input contract matching what the model expects, a
handler, and a result shape that serializes back into a `tool_result` block.

## Scope

1. Define the tool registry: `name → { schema, handler }`, surfaced to the Messages
   request as `tools` and dispatched in the PR 02 loop.
2. Implement filesystem tools (`Read`/`Write`/`Edit`/`Glob`/`Grep`) with the same
   semantics the SDK exposed — line-numbered reads, exact-match Edit, glob/ripgrep search.
3. Implement `Bash` with the same working-directory and output-capture behavior. **Do
   not** add security gating here — that is PR 05's `canUseTool` + YARA layer. Keep this
   PR about correct execution.
4. Implement the task tools (`TaskCreate`/`Update`/`Get`/`List`) backed by the same store
   the SDK-side tools wrote to, so program steps that read task state are unaffected.
5. Implement `ListMcpResourcesTool` against the in-process MCP registry (PR 04 provides
   the registry; stub the resource list until then).

## Acceptance criteria

- [ ] Each tool has unit tests covering success + error result shapes.
- [ ] Behavioral parity spot-checks vs the SDK on a sample repo: same Edit result for the
      same input, same Grep matches, same Glob ordering.
- [ ] Tool input schemas are accepted by the gateway/model without coercion errors.
- [ ] Flag remains **0% harness**.

## Files

- `src/lib/agent/runner/tools/` (new — one file per tool + `registry.ts`)
- `src/lib/agent/runner/harness-runner.ts` (wire dispatcher from PR 02)

## Notes

This is the largest surface and the most likely to harbor subtle drift. Prefer reusing
existing utilities (the repo already has file/search helpers) over re-implementing.
PR 08's parity suite is the real safety net here — keep it in mind while building.
