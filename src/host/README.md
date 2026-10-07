# Host

The host layer is what the two hosts, the TUI and headless, share about running
the wizard as a process: how a run ends. It owns:

- **The exit.** A host starts its exit with `startHostExit` and resolves an exit
  code; only the CLI and `bin.ts` call `process.exit`. `wizardAbort` ends a
  decided failure with the presenter its caller passes, and `registerShutdown`
  adds a hook the end runs first.

## Entry and imports

The TUI and headless import it through `@host/*`: `@host/wizard-abort` for the
exit. The CLI and the e2e harness may import it too.

The host layer may import `@env`, `@shared/*` and `@utils/*`, and nothing else:
the programs, the agent, the TUI, headless and the CLI are out of its reach, and
the programs and the agent never import it. See
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Where things live

| What                                | Where                                |
| ----------------------------------- | ------------------------------------ |
| The exit, aborts and shutdown hooks | [`wizard-abort.ts`](wizard-abort.ts) |
