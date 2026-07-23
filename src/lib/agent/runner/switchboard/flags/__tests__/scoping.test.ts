/**
 * The cross-experiment pin. Per-experiment behavior lives in the sibling
 * files; this file pins the WHOLE flag→program surface at once so it cannot
 * drift silently:
 *
 * 1. An empirically measured effect matrix — probe the resolver, don't trust
 *    the declarations — pinned to an explicit expected table.
 * 2. Every `*_FLAG_KEY` constant forced on simultaneously: only programs in
 *    the pinned matrix may resolve differently from an unflagged run.
 * 3. A seam scan: routing code outside `flags/` cannot read flag keys at all,
 *    so a new flag CANNOT affect routing without an experiment declaration —
 *    which the derived probes here then measure automatically.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import * as constants from '@lib/constants';
import {
  resolveBinding,
  type ProgramBinding,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import {
  HARNESS_EXPERIMENTS,
  SEQUENCE_EXPERIMENTS,
} from '@lib/agent/runner/switchboard/flags';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const AXES = ['sequence', 'harness', 'model', 'thinkingLevel'] as const;

/** Every wizard flag key the codebase defines, experiment-backed or not. */
const ALL_FLAG_KEYS = Object.entries(constants)
  .filter(([name]) => name.endsWith('_FLAG_KEY'))
  .map(([, value]) => value as string);

/** The strongest flag set each experiment can emit, derived from its declaration. */
const maxFlagsFor = (exp: (typeof HARNESS_EXPERIMENTS)[number]) => {
  const flags: Record<string, string> = { [exp.flags.useFlag]: 'true' };
  const payloads: Record<string, unknown> = {};
  if (exp.flags.modelFlag) {
    flags[exp.flags.modelFlag] = 'gpt-5-6-terra';
    flags[exp.flags.effortFlag] = 'high';
  } else {
    payloads[exp.flags.useFlag] = {
      model: 'gpt-5-6-terra',
      effort: 'high',
      harness: 'pi',
      sequence: 'orchestrator',
    };
  }
  return { flags, payloads };
};

const diffAxes = (
  program: (typeof PROGRAM_IDS)[number],
  flags: Record<string, string>,
  flagPayloads: Record<string, unknown>,
): string[] => {
  const base = resolveBinding({ program, flags: {} });
  const flagged = resolveBinding({ program, flags, flagPayloads });
  return AXES.filter(
    (axis) =>
      flagged[axis as keyof ProgramBinding] !==
      base[axis as keyof ProgramBinding],
  );
};

describe('flag scoping — the pinned effect matrix', () => {
  // Probe every experiment's strongest flags against EVERY registry program
  // and record which programs change and on which axes. This is measured
  // behavior, not declarations — if the resolver leaks, the matrix says so.
  it('matches exactly this flag → program → axes table', () => {
    const matrix: string[] = [];
    for (const exp of HARNESS_EXPERIMENTS) {
      const { flags, payloads } = maxFlagsFor(exp);
      for (const program of PROGRAM_IDS) {
        const axes = diffAxes(program, flags, payloads);
        if (axes.length > 0) {
          matrix.push(`${exp.flags.useFlag} → ${program}: ${axes.join(', ')}`);
        }
      }
    }
    for (const exp of SEQUENCE_EXPERIMENTS) {
      for (const program of PROGRAM_IDS) {
        const axes = diffAxes(program, { [exp.flag]: 'true' }, {});
        if (axes.length > 0) {
          matrix.push(`${exp.flag} → ${program}: ${axes.join(', ')}`);
        }
      }
    }
    // THE PIN. A new experiment, a widened scope, or a resolver leak all
    // change this table — updating it must be a reviewed, deliberate act.
    expect(matrix.sort()).toEqual([
      'wizard-orchestrator → posthog-integration: sequence',
      'wizard-self-driving-use-pi-harness → self-driving: sequence, harness, model, thinkingLevel',
      'wizard-use-pi-harness → posthog-integration: harness, model, thinkingLevel',
    ]);
  });

  it('every flag key in constants, forced on at once, touches nothing outside the matrix', () => {
    // 'true' everywhere (multivariate keys read it as an unknown variant →
    // fallback), plus a maximal payload under every key so a payload reader
    // on ANY flag would light up.
    const flags = Object.fromEntries(ALL_FLAG_KEYS.map((k) => [k, 'true']));
    const flagPayloads = Object.fromEntries(
      ALL_FLAG_KEYS.map((k) => [
        k,
        {
          model: 'gpt-5-6-terra',
          effort: 'high',
          harness: 'pi',
          sequence: 'orchestrator',
        },
      ]),
    );
    const COVERED = new Set<string>([
      ...HARNESS_EXPERIMENTS.map((e) => e.program),
      ...SEQUENCE_EXPERIMENTS.flatMap((e) => [...e.programs]),
    ]);
    for (const program of PROGRAM_IDS) {
      const ctx: SwitchboardCtx = { program, flags, flagPayloads };
      const flagged = resolveBinding(ctx);
      if (!COVERED.has(program)) {
        expect(flagged).toEqual(resolveBinding({ program, flags: {} }));
        expect(ctx.trace).toEqual({
          harness: 'binding',
          model: 'binding',
          sequence: 'binding',
        });
      }
    }
    // The two covered programs land exactly where their own experiments put
    // them — pinned literally so combined flags can't interfere either.
    expect(
      resolveBinding({ program: 'posthog-integration', flags, flagPayloads }),
    ).toEqual({
      sequence: constants.Sequence.orchestrator,
      harness: constants.Harness.pi,
      model: constants.GPT5_6_TERRA_MODEL, // 'true' is no variant → fallback
      thinkingLevel: undefined, // 'true' is no effort level → table default
    });
    expect(
      resolveBinding({ program: 'self-driving', flags, flagPayloads }),
    ).toEqual({
      sequence: constants.Sequence.orchestrator, // from its own payload only
      harness: constants.Harness.pi,
      model: constants.GPT5_6_TERRA_MODEL,
      thinkingLevel: 'high',
    });
  });
});

describe('flag scoping — routing reads live only in flags/', () => {
  // The structural guarantee behind the matrix: harness.ts / sequence.ts /
  // models.ts never index a flag key themselves, so a NEW flag physically
  // cannot route anything without an experiment declaration in flags/ —
  // and every declaration is auto-probed by the matrix above.
  const switchboardDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  for (const file of ['harness.ts', 'sequence.ts', 'models.ts', 'index.ts']) {
    it(`${file} contains no direct flag reads or flag-key imports`, () => {
      const src = readFileSync(join(switchboardDir, file), 'utf8');
      expect(src).not.toMatch(/ctx\.flags\[/);
      expect(src).not.toMatch(/flags\[['"`]/);
      expect(src).not.toMatch(/WIZARD_\w+_FLAG_KEY/);
    });
  }
});
