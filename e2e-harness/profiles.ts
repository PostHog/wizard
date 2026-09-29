/**
 * Per-program e2e profiles — the UI choices a headless run makes driving each
 * program's flow.
 *
 * Each program declares its test path as JSON in its own folder
 * (`src/programs/<id>/test/e2e.json`): the `program` id it drives, a
 * `profile` (the options the run auto-takes), optional `variations` and a
 * documented `path`. This module reads every such file once and keys it by
 * `program`, so a new program's `e2e.json` needs no change here.
 *
 * {@link resolveE2eProfile} folds the run's env-var inputs into a profile once,
 * so `decideE2eAction` stays a pure function of (state, profile).
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROGRAM_REGISTRY, type ProgramId } from '@programs';
import {
  DEFAULT_E2E_PROFILE,
  DEFAULT_E2E_VARIATION,
  type AskAnswerRule,
  type WizardE2eProfile,
  type WizardE2eVariation,
} from './e2e-profile.js';

/** The machine-read part of a program's `test/e2e.json`. */
interface E2eDefinition {
  program: ProgramId;
  profile: WizardE2eProfile;
  variations?: WizardE2eVariation[];
}

const PROGRAMS_DIR = fileURLToPath(
  new URL('../src/programs/', import.meta.url),
);

/** Every program folder's `test/e2e.json`, by the registered program it names. */
function loadDefinitions(): ReadonlyMap<ProgramId, E2eDefinition> {
  const registered = new Set<string>(PROGRAM_REGISTRY.map((c) => c.id));
  const definitions = new Map<ProgramId, E2eDefinition>();
  for (const entry of readdirSync(PROGRAMS_DIR, { withFileTypes: true })) {
    const file = path.join(PROGRAMS_DIR, entry.name, 'test', 'e2e.json');
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const definition = JSON.parse(readFileSync(file, 'utf8')) as E2eDefinition;
    if (!registered.has(definition.program)) {
      throw new Error(`${file}: no registered program "${definition.program}"`);
    }
    if (definitions.has(definition.program)) {
      throw new Error(`${file}: a second e2e.json for "${definition.program}"`);
    }
    definitions.set(definition.program, definition);
  }
  return definitions;
}

const DEFINITIONS = loadDefinitions();

/** The e2e profile for a program, or the happy-path default if none is set. */
export function profileFor(program: ProgramId): WizardE2eProfile {
  return DEFINITIONS.get(program)?.profile ?? DEFAULT_E2E_PROFILE;
}

/** Whether a program has an explicit (non-default) e2e profile. */
export function hasProfile(program: ProgramId): boolean {
  return DEFINITIONS.has(program);
}

/**
 * The switchboard variations to snapshot for a program — one run each. Falls
 * back to the single no-override baseline when a program declares none.
 */
export function variationsFor(program: ProgramId): WizardE2eVariation[] {
  return DEFINITIONS.get(program)?.variations ?? [DEFAULT_E2E_VARIATION];
}

/** Env-var inputs a run may layer over a program's declared profile. */
export interface E2eProfileOverrides {
  /** `E2E_NOTICE` — `keep` or `decline`. Anything else is ignored. */
  notice?: string;
  /**
   * Extra `askAnswers` rules, from `E2E_ANSWERS_FILE`. Merged *before* the
   * profile's own rules, so the runner can re-route one question per app
   * without editing the program's e2e.json.
   */
  extraAskAnswers?: AskAnswerRule[];
  /** Env map used to expand `${VAR}` inside every rule value. */
  env?: Record<string, string | undefined>;
}

/**
 * Fold a run's env-var inputs into a profile, once, at load.
 *
 * `decideE2eAction` is documented pure — same (state, profile) in, same
 * decision out. Reading `process.env` inside it would break that and make the
 * flow-snapshot test depend on the shell it runs in. So every env input is
 * resolved here instead, at the one point that already knows the run's
 * configuration. In an e2e run the environment is fixed when the wizard child
 * process starts, so resolving at load and resolving at answer time produce the
 * same answers.
 */
export function resolveE2eProfile(
  base: WizardE2eProfile,
  overrides: E2eProfileOverrides = {},
): WizardE2eProfile {
  const env = overrides.env ?? {};
  const rules = [
    ...(overrides.extraAskAnswers ?? []),
    ...(base.askAnswers ?? []),
  ];
  const resolved: WizardE2eProfile = {
    ...base,
    ...(rules.length > 0
      ? {
          // Spread the rule: interpolation only rewrites `value`, and dropping
          // any other field here would silently unset a rule's `secret` flag.
          askAnswers: rules.map((rule) => ({
            ...rule,
            value: interpolateEnv(rule.value, env),
          })),
        }
      : {}),
  };
  if (overrides.notice === 'keep' || overrides.notice === 'decline') {
    resolved.notice = overrides.notice;
  }
  return resolved;
}

/** Expand `${VAR}` from `env`. An unset var becomes an empty string. */
function interpolateEnv(
  value: string,
  env: Record<string, string | undefined>,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => env[name] ?? '',
  );
}
