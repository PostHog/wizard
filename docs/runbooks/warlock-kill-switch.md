# Runbook: Warlock scanning

**Purpose:** what to do when the wizard's Warlock / YARA security scanning
misbehaves, for example when it blocks legitimate commands or aborts runs on a
non-critical match.

**Owner:** docs-and-wizard team. Scanning is a security control: treat "on" as
the safe default.

## There is no remote switch

No feature flag turns scanning off. The wizard pins `@posthog/warlock` to one
version in [`package.json`](../../package.json), and every `pnpm build` runs
`pnpm test:warlock`
([`warlock-smoke-test.ts`](../../scripts/warlock-smoke-test.ts)).
That release gate scans one fixture per category with the real package and fails
the build if a bump stops matching one.

To change what scanning blocks, fix the rule in
[warlock](https://github.com/PostHog/warlock) and bump the pinned version. To
change how the wizard responds to a match, change the hook wiring in
[`yara-hooks.ts`](../../src/agent/yara-hooks.ts) or the Pi adapter in
[`security.ts`](../../src/agent/runner/harness/pi/security.ts). Either way, the
fix ships in a wizard release.

## Local override

`POSTHOG_WIZARD_WARLOCK_DISABLED=true` turns off the Anthropic SDK harness's
Pre/PostToolUse YARA hooks for one run. Only the literal string `true` disables
them; any other value leaves scanning on. A disabled run logs
`[warlock] scanning disabled for run (local env override)` and captures
`wizard: warlock disabled` with `reason: 'env-override'`.

The override has two limits:

- **The Pi harness always scans.** Pi is the default harness, and its security
  extension has no override.
- **The CLI rejects the variable.** The CLI reads every `POSTHOG_WIZARD_*`
  variable as an option, and its strict parser exits with
  `Unknown argument: warlockDisabled`. Only code that runs the agent without the
  CLI, such as the [developer interface](../developer-interfaces.md) examples,
  can use it.

## How it works

- **Decision:** `isWarlockDisabled()` in
  [`agent-interface.ts`](../../src/agent/agent-interface.ts) reads the variable.
  The unit tests in
  [`agent-interface.test.ts`](../../src/agent/__tests__/agent-interface.test.ts)
  (`describe('isWarlockDisabled (local env escape hatch)')`) pin that only
  `'true'` disables scanning.
- **Gate:** in the same file, a disabled run registers the Pre/PostToolUse hooks
  as empty arrays instead of `createPreToolUseYaraHooks()` and
  `createPostToolUseYaraHooks()`. The `Stop` hook is unaffected.

## Related

- Scanner engine and rules: the [warlock](https://github.com/PostHog/warlock)
  sibling repo.
- Security boundaries:
  [architecture](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#security-boundaries).
- Feedback and questions: wizard@posthog.com.
