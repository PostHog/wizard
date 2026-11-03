# Runbook: SDK capture mode (legacy vs capture v1 majors)

**Purpose:** control, from the flags UI and without a release, whether the
wizard pins each server and mobile PostHog SDK to its legacy major or to the
capture v1 major, and roll the capability itself out or back.

**Owner:** docs-and-wizard team.

---

## The two flags

Both live in the internal flags project the wizard evaluates (Project 2), and
both are in `WIZARD_FLAG_KEYS` (`src/shared/constants.ts`).

| Flag | Type | Off / absent | On |
| --- | --- | --- | --- |
| `wizard-sdk-capture-mode` | boolean | The run resolves no capture mode: installs by bare name, no read-back, no mode line in the prompt, no host probe. Exactly the behaviour before this capability existed. | The run resolves a mode per SDK from the allowlist (`src/shared/sdk-majors.ts`), pins the install, verifies the installed major and selects skill variants by mode. |
| `wizard-sdk-capture-v1` | boolean with a JSON payload | The allowlist's compiled default decides (`v1Released`, false for every SDK until a later release bakes a flip in). | Payload `{"<sdk>": "legacy" \| "v1"}` per SDK id: `v1` is that SDK's release-day flip for fresh installs; `legacy` is the kill switch after one. Unknown ids and values are ignored. |

SDK ids: `posthog-python`, `posthog-node`, `posthog-go`, `posthog-rs`,
`posthog-ios`, `posthog-android`, `posthog-flutter`.

An installed copy always wins over both flags: a project already on a major
keeps it, whatever the payload says.

---

## Rolling the capability out

1. Ship the release that carries the capability. The gate is off, so nothing
   changes for anyone.
2. Open **`wizard-sdk-capture-mode`**. Add a release condition on the person
   property `version` ≥ that release, so wizards in the field that lack the
   code never match. Target the team first (email or distinct id), then raise
   the rollout.
3. Every run now installs the legacy major pinned (`posthog-node@^5`,
   `"posthog>=7,<8"`, …). Confirm with the `sdk_capture_mode` property on the
   `wizard:` events: `legacy` with `sdk_mode_reason: not-released`.

To roll back: set the gate to 0%. The next run behaves as before.

---

## Flipping one SDK to its capture v1 major (release day)

Order matters: the major must be on the registry and the skills must carry the
v1 content before the flip, or the pinned install fails and the run stops.

1. The SDK's major is published and its docs pages are live.
2. context-mill: the SDK's `capture_mode: v1` variant points at the live docs
   and the registry pin; release it with `DOCS_CACHE_TTL_MS=0`.
3. Open **`wizard-sdk-capture-v1`**, set the payload to include
   `"<sdk>": "v1"`, keep the other ids as they were, serve to 100%.
4. Watch `sdk_capture_mode: v1` with `sdk_mode_reason: default` on fresh
   installs for that SDK, and `PHW_AGENT_SDK_MAJOR_MISMATCH` in the error
   events: a burst of mismatches means the install resolved another major.

To kill the flip for that SDK: set its payload value to `"legacy"`. To remove
the override later and let the table decide, delete the id from the payload.

A fresh install still goes to legacy, with the reason in the prompt and in
`sdk_mode_reason`, when the project is under the SDK's floor (`floor`), when
the host does not serve the v1 routes (`host`), or when the integration keeps
that SDK on legacy by policy (`secondary-policy`, the server-rendered web
frameworks on posthog-node).

---

## Scoping the blast radius

Both flags take the usual release conditions: a person property, a
percentage, an email. The flip is per SDK by construction; the gate is for
the whole capability.

---

## Verify it took effect

- Both flags are read once at run start (`getAllFlagsForWizard()`), so a
  change reaches the next run, not one in flight.
- Properties on every `wizard:` event once the user granted the scan consent:
  `sdk_id`, `sdk_capture_mode` (`legacy`, `v1`, `conflict`),
  `sdk_resolved_major`, `sdk_mode_reason` (`installed`, `flag`,
  `secondary-policy`, `not-released`, `floor`, `host`, `default`) and
  `sdk_capture_modes` (one summary per SDK the run touched).
- In a run's log: `[sdk-capture-mode] resolved` lines and, on a non-cloud
  host, `[host-v1-probe]` lines.

---

## Local / CI override

The published build reads only the real flags. A dev or CI build pins them per
run with the CI override, which is stripped from published builds:

```bash
WIZARD_CI_FLAG_OVERRIDES='{"wizard-sdk-capture-mode":"true","wizard-sdk-capture-v1":{"posthog-python":"v1"}}' pnpm try --install-dir=<path>
```

The wizard-workbench CI exports the same variable on every leg, so a
pre-release run of the v1 path needs only that value in the leg's environment.

---

## How it works (for the person debugging)

- Table: `src/shared/sdk-majors.ts` (one row per SDK: last legacy major,
  first v1 major, pins per mode, `v1Released` default).
- Resolver: `src/shared/sdk-capture-mode.ts` (installed copy, flag payload,
  policy, release state, floor, host, in that order).
- Gate and settlement: `src/services/detection/sdk-capture-modes.ts`
  (`settleSdkCaptureModes`, run once per agent run by the program runner).
- Install command: `src/services/detection/sdk-install-recommendation.ts`
  (what `detect_package_manager` returns).
- Read-back and conflict stop: `src/services/detection/sdk-capture-mode-verify.ts`.
- Floors: `src/services/detection/sdk-floors.ts`. Host probe:
  `src/shared/host-v1-probe.ts`.
