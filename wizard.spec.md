# Wizard architecture pilot

Keep program routing, derived screens, and Pi tool rejection connected to their existing implementation and regression tests.

## invariants

- program bindings cover the registry
- screens derive from program steps
- tool-output scanner errors latch criticalViolation

## works when

- boundary "program bindings cover the registry" at PROGRAM_BINDINGS via test "switchboard PROGRAM_BINDINGS"
- boundary "screens derive from program steps" at createProgramSequence via guard "createProgramSequence"
- boundary "tool-output scanner errors latch criticalViolation" at createSecurityExtension via guard "a scanner error on tool output latches"
- src/ui/tui/screen-sequences.ts imports @lib/programs/program-registry
- src/ui/tui/screen-sequences.ts imports @lib/programs/program-step

## why

These are existing contracts that contributor skills rely on. Binding coverage uses the live program registry; screen projection and scanner-failure behavior use focused scenario tests, so those two claims use `via guard` rather than asserting exhaustive domain coverage. The latter proves the tool-output scanner failure scenario, not every scanner or rejection path.

The [development policy](.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission) chooses Pi for new work and prefers orchestration. Existing runtime defaults have not all migrated; this spec does not pretend they have. Gateway allowlists and required prompt policy are external contracts that require separate review.
