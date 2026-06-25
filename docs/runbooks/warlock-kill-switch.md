# Runbook: Warlock kill switch

**Purpose:** turn off the wizard's Warlock / YARA security scanning in the field
— remotely, without reverting commits or cutting a release — when it misbehaves.

**Owner:** docs-and-wizard team · **Severity to flip:** your call; this disables
a security control, so treat "on" (scanning enabled) as the safe default.

---

## When to reach for this

Flip the kill switch when Warlock is doing more harm than good in production,
e.g.:

- Legitimate commands are being **blocked** (false-positive on a PreToolUse
  scan).
- Runs are **aborting** mid-integration on a non-critical match.
- A measurable **drop in wizard completion** correlates with a Warlock rollout.
- You need to **A/B confirm** Warlock is the cause by running with it off.

If you only need to debug locally, use the [env override](#local--ci-override)
instead — don't touch the shared flag.

---

## TL;DR — how to flip it

1. Go to Project 2 feature flags.
2. Open **`wizard-warlock-disabled`**.
3. To kill for everyone: set rollout to **100%** (boolean serves `true`). Save.
4. New wizard runs stop scanning within seconds–minutes. Confirm via the
   **`wizard: warlock disabled`** event in the same project.

To re-enable: set the flag back to **0%** (or delete the release condition).

---

## Scoping the blast radius

You don't have to disable it for everyone. In the flag's release conditions you
can target a subset by person property:

- **One org melting down:** match on organization id / email / `distinct_id`.
- **Canary back-out:** drop rollout from 100% → a smaller %.
- **Everyone:** 100% rollout.

Narrower is better — keep the security net on for users who aren't affected.

---

## Verify it took effect

- Watch for the **`wizard: warlock disabled`** event. It fires once per run that
  started with scanning disabled, with `reason: "kill-switch"`.
- If you have a disabled run's log, you'll see:
  `[warlock] kill switch active — YARA scanning disabled for run`.
- Absence of the event after flipping = runs aren't picking up the flag yet (see
  [timing](#timing--reach) and [limitations](#limitations)).

---

## Timing & reach

- The flag is read **once at run start**
  ([`agent-runner.ts`](../../src/lib/agent/agent-runner.ts),
  `getAllFlagsForWizard()`), so a change takes effect on the **next** run — not
  on runs already in flight. Wizard runs are short-lived, so "next run" is
  effectively seconds to minutes.
- There is **no in-flight abort**, and you don't need one.

---

## Local / CI override

For debugging on your own machine or in CI — without touching the shared flag:

```bash
POSTHOG_WIZARD_WARLOCK_DISABLED=true npx @posthog/wizard
# or, in-repo:  POSTHOG_WIZARD_WARLOCK_DISABLED=true pnpm try --install-dir=<path>
```

Same fail-safe polarity: only the literal string `true` disables scanning. This
is a **local tool only** — it is per-machine and is **not** the incident lever.

---

## How it works (for the person debugging)

One feature flag, read at run start, gates the two hooks Warlock registers.

- **Flag key:** `wizard-warlock-disabled` —
  [`src/lib/constants.ts`](../../src/lib/constants.ts)
  (`WIZARD_WARLOCK_DISABLED_FLAG_KEY`).
- **Decision helper:** `isWarlockDisabled(flags)` in
  [`src/lib/agent/agent-interface.ts`](../../src/lib/agent/agent-interface.ts) —
  pure, unit-tested.
- **The gate:** at hook registration in the same file, when disabled the
  Pre/PostToolUse YARA hooks are registered as empty arrays (`[]`) instead of
  `createPreToolUseYaraHooks()` / `createPostToolUseYaraHooks()`. The SDK then
  never invokes them. The unrelated `Stop` hook is untouched.

### Fail-safe behavior (important)

Scanning is disabled **only** when the flag (or env override) resolves to the
exact string `'true'`. Everything else leaves Warlock **ON**:

| Situation                                                         | Result      |
| ----------------------------------------------------------------- | ----------- |
| Flag missing / not set                                            | Warlock ON  |
| Flag fetch fails or times out (returns `{}`)                      | Warlock ON  |
| Flag value `'false'`, `'True'`, `'1'`, anything ≠ `'true'`        | Warlock ON  |
| Flag value `'true'` **or** `POSTHOG_WIZARD_WARLOCK_DISABLED=true` | Warlock OFF |

A network blip must never silently disable a security control. This is pinned by
unit tests in
[`src/lib/__tests__/agent-interface.test.ts`](../../src/lib/__tests__/agent-interface.test.ts)
(`describe('isWarlockDisabled (kill switch)')`).

---

## Limitations

- **Version reach:** the switch only affects wizard versions that ship with the
  flag-reading code. `npx @posthog/wizard` pulls latest by default, so most
  users get it, but anyone pinned to an **older** version keeps running Warlock
  as built — the flag can't reach them.
- **Not a behavior dial:** today it's all-or-nothing (scan vs. don't scan).
  There is no "warn-but-allow" mode. If "kills runs too often" is the real
  problem, that's a separate change.

---

## Prerequisites / ownership

- **Pre-create the flag.** `wizard-warlock-disabled` should exist at **0%
  rollout** _before_ Warlock is widely used, so an incident is a one-field flip
  (0 → 100), never "create a flag from scratch under pressure."
- **Access control.** Anyone who can edit this flag can silently disable the
  wizard's safety net for targeted users. Keep edit access to the people who
  should have it — the kill switch is itself a security-sensitive lever.

---

## Related

- Scanner engine & rules: the [warlock](https://github.com/PostHog/warlock)
  sibling repo.
- Hook wiring: [`src/lib/yara-hooks.ts`](../../src/lib/yara-hooks.ts).
- Feedback / questions: wizard@posthog.com.
