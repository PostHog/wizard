# Runbook: agentic monorepo detection (headless)

**Purpose:** turn the wizard's agentic project detection for **non-interactive**
basic-integration runs on or off in the field — remotely, without cutting a
release — and understand exactly what changes when you do.

**Owner:** docs-and-wizard team · **Default:** **off**. The safe state is off
(unchanged deterministic root detection); this flag _adds_ a capability, it does
not gate a safety control.

---

## What this flag does

A headless / CI basic-integration run detects the framework deterministically at
the **repo root** (`detectFramework`, first match). In a monorepo that picks the
wrong project or nothing at all.

When this flag is on, a phase runs first (`scopeInstallDirToProject`, the first
step of `posthog-integration`'s `ciPreRun`): an agent scans the repo, labels the
main user-facing app **recommended**, and re-points `session.installDir` at it —
then the unchanged deterministic detection runs _inside that directory_. Off,
the phase is skipped entirely and the run behaves exactly as it does today.

This only affects **non-interactive** runs (headless cloud + `--ci`).
Interactive TUI runs have their own detect step and never enter this phase.

---

## TL;DR — how to flip it

1. Go to Project 2 feature flags.
2. Open **`basic-integration-agentic-detection`**.
3. To enable for everyone: set rollout to **100%** (boolean serves `true`).
   Save.
4. New non-interactive runs pick it up within seconds–minutes. Confirm via the
   **`wizard: agentic detection`** event (`outcome` ≠ `flag-off`).

To turn it back off: set the flag to **0%** (or delete the release condition).
Runs immediately return to root detection — no revert, no release.

---

## Scoping the blast radius

Even fully on, the reach is narrow — and you can narrow it further.

**Who it can touch at all:**

- **Non-interactive basic-integration runs only** — headless (cloud web app) and
  `--ci` (CI/CD). Interactive `npx @posthog/wizard` users are never affected.
- **Monorepos only, in practice.** On a single-project repo the scan recommends
  `.` and `resolveProjectDir` returns the install dir unchanged — a no-op. Only
  repos where the root is the wrong place to install see a changed directory.

**Targeting a subset** (flag release conditions, by person property):

- **Canary:** roll out 1% → 10% → 100%, watching the outcome mix.
- **One org / cohort:** match organization id / email / `distinct_id`.
- **Everyone:** 100%.

**What changes downstream when it fires:**

- `session.installDir` is re-pointed to a subdirectory. Every later phase
  (deterministic detect, the agent run, the SDK install, the setup report) then
  operates in that subdirectory instead of the repo root.
- One extra **Haiku agent scan** (~10–20s observed) and one **idempotent auth**
  run before the integration. The scan uses **read-only** tools (Read, Grep,
  Glob) — it never writes to the repo.

**Bounded downside.** On any failure — flag fetch fails, scan throws, or nothing
choosable — the session is left **untouched** and the run continues from the
original install dir. You never do _worse_ than root detection: you either
improve the pick or fall back to today's behavior.

**Path safety.** The chosen path is agent output, so it's clamped: `coercePath`
(agent side) and `resolveProjectDir` (caller side) reject absolute paths and
`..` escapes, so a hallucinated or hostile path can't steer the install outside
the repo root.

---

## Verify it took effect

Every run through the phase fires exactly one **`wizard: agentic detection`**
event, so you can branch funnels on `outcome`:

| `outcome`              | meaning                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `flag-off`             | flag not `true` **or** flag fetch failed → phase skipped                     |
| `error`                | scan threw; also reported to error tracking (`step: agentic_detection`)      |
| `no-project`           | scan ran, found nothing instrumentable → install dir unchanged               |
| `recommended`          | re-pointed to the agent's recommended app                                    |
| `first-instrumentable` | no recommendation usable; re-pointed to first supported PostHog-free project |

Success (`recommended` / `first-instrumentable`) and `no-project` events carry
the scan facts: `duration_ms`, `repo_type`, `project_count`, `supported_count`,
`has_recommendation`, and the chosen `chosen_framework` / `chosen_path`.

In a run log (dev / `--ci`) you'll see `Scanning the repo for projects...`
followed by `Continuing with <dir> (<framework>).` when it re-points.

---

## Timing & reach

- The flag is read **once per run**, at the top of the phase, via
  `analytics.getAllFlagsForWizard()`. A change takes effect on the **next**
  non-interactive run — never on a run already in flight. These runs are
  short-lived, so "next run" is effectively seconds to minutes.
- A failed flag fetch surfaces as an empty map, which reads as **off** — during
  rollout a flaky flag endpoint reads as flag-off, not as a mysteriously low
  rollout percentage.

---

## Local / CI override

For debugging or CI — without touching the shared flag — force it on in a dev
build:

```bash
WIZARD_CI_FLAG_OVERRIDES='{"basic-integration-agentic-detection":"true"}' \
  npx @posthog/wizard --ci --install-dir=<monorepo> --api-key=phx_… --region=us
```

This override path exists **only in dev / CI builds**. Published builds inline
`NODE_ENV="production"`, the override collapses, and the bundler strips it — so
this can never be a production surface.

---

## How it works (for the person debugging)

- **Flag key:** `basic-integration-agentic-detection` —
  [`src/lib/constants.ts`](../../src/lib/constants.ts)
  (`BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY`). It is **not** `wizard-`
  prefixed, so the gateway flag-header forwarding (which only forwards
  `wizard-*`) skips it — this flag stays wizard-local.
- **The gate + phase:** `scopeInstallDirToProject` in
  [`src/lib/detection/project-scope.ts`](../../src/lib/detection/project-scope.ts)
  — early idempotent auth → flag check (`!== 'true'` → `flag-off`, return) →
  scan with `recommend: true` → `chooseIntegrationProject` → re-point
  `session.installDir` via `resolveProjectDir`.
- **The call site:** one line at the top of `ciPreRun` in
  [`src/lib/programs/posthog-integration/index.ts`](../../src/lib/programs/posthog-integration/index.ts).
  The deterministic `detectFramework` that follows runs in the chosen directory.
- **The detector:** `detectProjectsWithAgent` /
  [`src/lib/detection/agentic.ts`](../../src/lib/detection/agentic.ts) — a Haiku
  agent, read-only tools, product-knowledge-free (the caller passes the
  framework targets).

### Fail-safe polarity (important)

The phase runs **only** when the flag resolves to the exact string `'true'`.
Everything else leaves the run on **today's root detection**:

| Situation                                                  | Result                     |
| ---------------------------------------------------------- | -------------------------- |
| Flag missing / not set                                     | root detection             |
| Flag fetch fails or times out (returns `{}`)               | root detection             |
| Flag value `'false'`, `'True'`, `'1'`, anything ≠ `'true'` | root detection             |
| Flag value `'true'` (or the CI override above)             | agentic scan runs          |
| Agentic scan enabled but throws / finds nothing            | root detection (untouched) |

Pinned by unit tests in
[`src/lib/detection/__tests__/project-scope.test.ts`](../../src/lib/detection/__tests__/project-scope.test.ts)
(every path fires exactly one outcome event; the session is untouched on every
fallback).

---

## Limitations

- **Version reach:** the flag only reaches wizard versions that ship with the
  reading code. `npx @posthog/wizard` pulls latest, so most callers get it, but
  a pinned older version can't see it.
- **Monorepo shape drives quality:** the pick is an LLM judgment. It is stable
  and correct on common layouts (one client app among servers/libs; several
  client apps with one primary), but a genuinely ambiguous monorepo can land on
  a defensible-but-different app than a human would. The event's `chosen_path`
  lets you audit this after the fact.
- **Adds latency:** one extra agent scan per run (~10–20s). Off, there is zero
  added cost.

---

## Prerequisites / ownership

- **Pre-create the flag** at **0% rollout** so enabling is a one-field flip (0 →
  canary → 100), never "create a flag under pressure."
- **Watch the outcome mix** while rolling out: a rising `error` or `no-project`
  share on repos you expected to instrument is the signal to pause and inspect
  `chosen_path` / the `agentic_detection` exceptions.

---

## Related

- The agentic detector:
  [`src/lib/detection/agentic.ts`](../../src/lib/detection/agentic.ts).
- Self-driving uses the same detector with a different chooser —
  [`src/lib/programs/self-driving/detect-agentic.ts`](../../src/lib/programs/self-driving/detect-agentic.ts).
- Feedback / questions: wizard@posthog.com.
