/**
 * Phase transitions from [STATUS] in assistant text.
 *
 * Phases are program-specific: each program emits its own `[STATUS]` phrases,
 * so the detector is seeded with the phase map for the program being run. Keep
 * each map in sync with that program's "Status to report" bullets (framework
 * programs) or its skill step `[STATUS]` lines (skill programs).
 *
 * Programs without a map fall back to the core integration phases, which
 * preserves the historical single-program behaviour.
 */

interface PhaseMap {
  /** Phase names in the order the program emits them. */
  order: readonly string[];
  /** The `[STATUS]` phrases that mark the start of each phase. */
  phrasesByPhase: Record<string, string[]>;
}

/** Core `posthog-integration` flow. Also the fallback for unmapped programs. */
const INTEGRATION_PHASES: PhaseMap = {
  order: ['1.0-begin', '1.1-edit', '1.2-revise', '1.3-conclude'],
  phrasesByPhase: {
    '1.0-begin': [
      'Checking project structure',
      'Verifying PostHog dependencies',
      'Generating events based on project',
    ],
    '1.1-edit': ['Inserting PostHog capture code'],
    '1.2-revise': [
      'Finding and correcting errors',
      'Report details of any errors you fix',
      'Linting, building and prettying',
    ],
    '1.3-conclude': ['Configured dashboard', 'Created setup report'],
  },
};

/**
 * `wizard logs` → the `logs-setup` skill's 7-step chain (context-mill
 * `context/skills/logs-setup`). One phase per step, keyed off the first
 * `[STATUS]` line each step emits. Keep in sync with the step reference files.
 */
const LOGS_PHASES: PhaseMap = {
  order: [
    '1-detect',
    '2-install',
    '3-plan',
    '4-context',
    '5-attach',
    '6-verify',
    '7-report',
  ],
  phrasesByPhase: {
    '1-detect': [
      'Detecting application runtime',
      'Finding existing logging',
      'Checking for PostHog SDKs',
      'Locating request identity',
    ],
    '2-install': [
      'Resolving ingestion region',
      'Adding OpenTelemetry packages',
      'Wiring the log exporter',
    ],
    '3-plan': [
      'Mapping log emitting surfaces',
      'Tracing identity to log call sites',
      'Choosing correlation tier',
      'Writing correlation plan',
    ],
    '4-context': [
      'Configuring client to send identity headers',
      'Adding request identity context',
      'Binding identity to the request',
    ],
    '5-attach': [
      'Adding correlation to the logging pipeline',
      'Checking log call sites are covered',
    ],
    '6-verify': [
      'Installing dependencies',
      'Linting files I edited',
      'Running type check',
      'Running build',
      'Emitting a test log record',
    ],
    '7-report': ['Writing logs setup report'],
  },
};

const PHASES_BY_PROGRAM: Record<string, PhaseMap> = {
  'posthog-integration': INTEGRATION_PHASES,
  logs: LOGS_PHASES,
};

const DEFAULT_PHASES = INTEGRATION_PHASES;

export class PhaseDetector {
  private readonly phases: PhaseMap;
  private currentPhase: string;

  /**
   * @param programId Program being benchmarked. Selects the phase map; unknown
   * or omitted falls back to the core integration phases.
   */
  constructor(programId?: string) {
    this.phases = (programId && PHASES_BY_PROGRAM[programId]) || DEFAULT_PHASES;
    this.currentPhase = 'setup';
  }

  detect(message: any): string | null {
    if (message.type !== 'assistant') return null;

    const nextPhase = this.getNextPhase();
    if (nextPhase === null) return null;

    const content = message.message?.content;
    if (!Array.isArray(content)) return null;

    for (const block of content) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      if (!block.text.includes('[STATUS]')) continue;

      const phrases = this.phases.phrasesByPhase[nextPhase] ?? [];
      for (const phrase of phrases) {
        if (block.text.includes(phrase)) {
          this.currentPhase = nextPhase;
          return nextPhase;
        }
      }
    }

    return null;
  }

  private getNextPhase(): string | null {
    const { order } = this.phases;
    if (this.currentPhase === 'setup') return order[0] ?? null;
    const i = order.indexOf(this.currentPhase);
    if (i < 0 || i >= order.length - 1) return null;
    return order[i + 1];
  }

  reset(): void {
    this.currentPhase = 'setup';
  }
}
