import fs from 'fs';
import path from 'path';

import { Integration } from '../../constants.js';
import type { WizardSession } from '../../wizard-session.js';

/**
 * The handoff document the wizard writes alongside the agent-generated setup
 * report. The report describes WHAT changed; this file describes what the
 * developer (or their coding agent) still needs to do to take the integration
 * from "wizard finished" to "merged" — verification steps, known SDK quirks,
 * and project glue the wizard intentionally did not touch.
 *
 * The doc is rendered deterministically by the wizard (not asked of the
 * agent) so the verification checklist and known-quirk list stay stable
 * across model versions and don't depend on the agent's prompt-following.
 *
 * Background: https://github.com/PostHog/wizard/issues/447 — the existing
 * setup report worked as a manifest but left common gaps for the calling
 * agent to discover by trial and error.
 */
export const NEXT_STEPS_FILE = 'posthog-next-steps.md';

export interface NextStepsContext {
  /** Display name of the framework, e.g. "Next.js". */
  frameworkName: string;
  /** Integration enum value — drives quirk lookup, JS-vs-non-JS branching, and source-maps inclusion. */
  integration: Integration;
  /** File the agent wrote describing what changed. Linked from the handoff. */
  reportFile: string;
  /** Names of env vars the wizard configured for this stack. */
  envVarNames: string[];
  /** True when LLM analytics is queued to install in the same run. */
  llmAnalyticsQueued: boolean;
}

/**
 * Result shape returned by `writeNextStepsFile` and stashed on
 * `WizardSession.frameworkContext` for `buildOutroData` to read. Exported so
 * the producer (`writeNextStepsFile`) and consumer (`buildHandoffBullet` +
 * any future reader) cannot drift apart.
 */
export type NextStepsHandoffStatus =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * `frameworkContext` key under which `setNextStepsHandoff` stashes the
 * write result. Stored on `frameworkContext` because that's the existing
 * pattern (see `DASHBOARD_DEEP_LINK_KEY`, `AUDIT_CHECKS_KEY`).
 */
export const NEXT_STEPS_HANDOFF_KEY = 'nextStepsHandoff';

/** Integrations whose project source is JavaScript / TypeScript. */
const JS_INTEGRATIONS: ReadonlySet<Integration> = new Set([
  Integration.nextjs,
  Integration.nuxt,
  Integration.vue,
  Integration.reactRouter,
  Integration.tanstackStart,
  Integration.tanstackRouter,
  Integration.reactNative,
  Integration.angular,
  Integration.astro,
  Integration.sveltekit,
  Integration.javascriptNode,
  Integration.javascript_web,
]);

/**
 * Integrations that produce minified browser bundles where source maps help.
 * Note: `SOURCE_MAP_INTEGRATIONS ⊆ JS_INTEGRATIONS` — a non-JS source-map case
 * would break that subset assumption and require the rendering logic to be
 * revisited.
 */
const SOURCE_MAP_INTEGRATIONS: ReadonlySet<Integration> = new Set([
  Integration.nextjs,
  Integration.nuxt,
  Integration.vue,
  Integration.reactRouter,
  Integration.tanstackStart,
  Integration.tanstackRouter,
  Integration.angular,
  Integration.astro,
  Integration.sveltekit,
  Integration.javascript_web,
]);

/**
 * Per-integration SDK quirks. Exhaustive over the `Integration` enum so
 * adding a new integration forces a conscious decision (an empty array is
 * fine — it just means "no quirks recorded yet"). LLM-analytics quirks are
 * merged in conditionally below; do NOT add them here.
 */
const KNOWN_QUIRKS_BY_INTEGRATION: Record<Integration, string[]> = {
  [Integration.nextjs]: [],
  [Integration.nuxt]: [],
  [Integration.vue]: [],
  [Integration.reactRouter]: [],
  [Integration.tanstackStart]: [],
  [Integration.tanstackRouter]: [],
  [Integration.reactNative]: [],
  [Integration.angular]: [],
  [Integration.astro]: [],
  [Integration.django]: [],
  [Integration.flask]: [],
  [Integration.fastapi]: [],
  [Integration.laravel]: [],
  [Integration.sveltekit]: [],
  [Integration.swift]: [],
  [Integration.android]: [],
  [Integration.rails]: [],
  [Integration.python]: [],
  [Integration.ruby]: [],
  [Integration.javascriptNode]: [],
  [Integration.javascript_web]: [],
};

/**
 * Quirks that only apply when LLM analytics is being installed in the same
 * run AND the project is JS/TS (the only stack `@posthog/ai` ships for).
 */
const LLM_ANALYTICS_QUIRKS_FOR_JS: readonly string[] = [
  "`@posthog/ai`'s `PostHogAnthropic` only intercepts `messages.create()`. Don't use `messages.stream(...)` — it bypasses the wrapper and crashes at runtime when the SDK calls `.withResponse()` on the wrapped value. Use `messages.create({ stream: true, ... })` and iterate the lower-level events instead.",
];

/**
 * Build the markdown content. Pure function so it is trivial to unit-test
 * and to render outside of a wizard run.
 */
export function buildNextStepsMarkdown(ctx: NextStepsContext): string {
  const {
    frameworkName,
    integration,
    reportFile,
    envVarNames,
    llmAnalyticsQueued,
  } = ctx;
  const isJs = JS_INTEGRATIONS.has(integration);
  const wantsSourceMaps = SOURCE_MAP_INTEGRATIONS.has(integration);

  const baseQuirks = KNOWN_QUIRKS_BY_INTEGRATION[integration];
  const llmQuirks =
    llmAnalyticsQueued && isJs ? [...LLM_ANALYTICS_QUIRKS_FOR_JS] : [];
  const allQuirks = [...baseQuirks, ...llmQuirks];

  const verifyItems = [
    'Run a production build to catch lint and type issues from generated code.',
    isJs
      ? 'Run unit tests — wizard-rewritten routes may have outdated mocks (e.g. tests that mocked the bare SDK now need to mock the wrapped client).'
      : 'Run unit / integration tests.',
    'Smoke-test one capture call in the running app and confirm the event appears in PostHog.',
    'Smoke-test the identify path and confirm the distinct id matches your user model — including the *returning visitor* path that auto-redirects past your auth submit handler.',
  ];
  if (llmAnalyticsQueued) {
    verifyItems.push(
      'Smoke-test one streaming and one non-streaming LLM call and confirm `$ai_generation` events appear in PostHog.',
    );
    if (isJs) {
      verifyItems.push(
        'Search for any remaining direct LLM SDK constructors (`new Anthropic()`, etc.) or non-type imports of `@anthropic-ai/sdk` and migrate them to the wrapped client. Automated detection can miss non-standard import shapes.',
      );
    }
  }

  const envCallout =
    envVarNames.length > 0
      ? `${envVarNames.map((n) => `\`${n}\``).join(' / ')} placeholder${
          envVarNames.length === 1 ? '' : 's'
        }`
      : 'the env vars the wizard added';

  const projectGlue = [
    `If your project has a \`.env.example\`, add ${envCallout} so collaborators know what to set.`,
    'Worktree / monorepo bootstrap scripts — add a step that copies any gitignored env file (e.g. `.env.local`) if your team uses one.',
    'Agent guides (`AGENTS.md` / `CLAUDE.md` / similar) — document how PostHog is wired so future contributions keep instrumentation parity.',
  ];
  if (wantsSourceMaps) {
    projectGlue.push(
      "Source maps — wire `posthog-cli sourcemap` (or your bundler's upload step) in CI to get readable production stack traces.",
    );
  }

  return [
    '# PostHog setup: next steps',
    '',
    `The wizard finished installing PostHog into your ${frameworkName} project. The companion file \`${reportFile}\` is the *manifest* of what changed; this file is the *handoff* — verification steps, known SDK quirks, and project glue we intentionally did not touch.`,
    '',
    'Hand both files to your coding agent (or work through them yourself) before merging.',
    '',
    '## Verify before merging',
    '',
    verifyItems.map((it) => `- [ ] ${it}`).join('\n'),
    '',
    '## Known SDK quirks',
    '',
    allQuirks.length > 0
      ? allQuirks.map((q) => `- ${q}`).join('\n')
      : '_No additional quirks recorded for this integration. If you hit one, please file an issue at https://github.com/PostHog/wizard/issues._',
    '',
    '## Project glue we did NOT touch',
    '',
    'These are stack- or team-specific files the wizard never edits. If your project uses any of them, update them yourself:',
    '',
    projectGlue.map((g) => `- ${g}`).join('\n'),
    '',
    '## Token-absent behavior',
    '',
    'By default the SDK logs warnings and may retry sends if the project token is unset. If you have CI / e2e environments without PostHog, consider noop-shimming the wizard-generated PostHog client wrapper so missing config is silent and safe.',
    '',
    '## Hand this to your coding agent',
    '',
    'Copy and run:',
    '',
    `> Read \`${reportFile}\` and \`${NEXT_STEPS_FILE}\`. Verify each item in the "Verify before merging" checklist. Apply any fixes for items that fail. Update the project glue listed in this file if it applies. Open a PR with the changes plus a summary of what was verified.`,
    '',
  ].join('\n');
}

/**
 * Write `posthog-next-steps.md` into the install directory. Best-effort: if
 * the write fails (read-only fs, missing dir, etc.) we surface the error to
 * the caller rather than aborting the wizard run, so a successful integration
 * isn't undone by a failed follow-up file. The try block is intentionally
 * narrow — it covers only the disk write, so a programmer error in template
 * construction (a missing field, a thrown helper) still propagates loudly
 * instead of being swallowed as `{ ok: false, error: ... }`.
 */
export function writeNextStepsFile(
  installDir: string,
  ctx: NextStepsContext,
): NextStepsHandoffStatus {
  const filePath = path.join(installDir, NEXT_STEPS_FILE);
  const content = buildNextStepsMarkdown(ctx);
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Type guard for runtime-shaped `NextStepsHandoffStatus`. Used by
 * `getNextStepsHandoff` to defend against `frameworkContext` ever holding a
 * differently-shaped value at the same key — keeps the unsafe `as` cast
 * confined to one place behind a real check.
 */
function isNextStepsHandoffStatus(
  value: unknown,
): value is NextStepsHandoffStatus {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ok' in value) || typeof (value as { ok: unknown }).ok !== 'boolean') {
    return false;
  }
  if ((value as NextStepsHandoffStatus).ok) {
    return typeof (value as { path?: unknown }).path === 'string';
  }
  return typeof (value as { error?: unknown }).error === 'string';
}

/**
 * Read the stashed handoff result from a session. Returns `undefined` when
 * `setNextStepsHandoff` was never called or when `frameworkContext` holds an
 * unexpected shape — `buildHandoffBullet` translates `undefined` to a silent
 * drop, so a missing key never produces a misleading outro line.
 */
export function getNextStepsHandoff(
  session: WizardSession,
): NextStepsHandoffStatus | undefined {
  const raw = session.frameworkContext[NEXT_STEPS_HANDOFF_KEY];
  return isNextStepsHandoffStatus(raw) ? raw : undefined;
}

/** Stash the handoff result on a session for `buildOutroData` to read. */
export function setNextStepsHandoff(
  session: WizardSession,
  status: NextStepsHandoffStatus,
): void {
  session.frameworkContext[NEXT_STEPS_HANDOFF_KEY] = status;
}

/**
 * Render the outro bullet line for a stashed handoff status. Three states:
 *  - `ok: true`  — celebrate the new file.
 *  - `ok: false` — surface the failure where the user will actually see it
 *                  (the warn line in `postRun` scrolls past as the outro
 *                  screen renders).
 *  - `undefined` — empty string; `.filter(Boolean)` in the caller drops it
 *                  so workflows that never wrote the handoff stay quiet.
 */
export function buildHandoffBullet(
  status: NextStepsHandoffStatus | undefined,
): string {
  if (!status) return '';
  return status.ok
    ? `Wrote ${NEXT_STEPS_FILE} with verification + handoff steps`
    : `Could NOT write ${NEXT_STEPS_FILE} (${status.error}) — handoff steps are missing`;
}
