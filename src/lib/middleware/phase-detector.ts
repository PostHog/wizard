/** Phase transitions from [STATUS] in assistant text. Keep in sync with workflow "Status to report" bullets. */

const PHASES_ORDER = [
  '1.0-begin',
  '1.1-edit',
  '1.2-revise',
  '1.3-conclude',
] as const;

const STATUS_PHRASES_BY_PHASE: Record<(typeof PHASES_ORDER)[number], string[]> =
  {
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
  };

export class PhaseDetector {
  private currentPhase: 'setup' | (typeof PHASES_ORDER)[number] = 'setup';

  detect(message: any): string | null {
    if (message.type !== 'assistant') return null;

    const nextPhase = this.getNextPhase();
    if (nextPhase === null) return null;

    const content = message.message?.content;
    if (!Array.isArray(content)) return null;

    for (const block of content) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      if (!block.text.includes('[STATUS]')) continue;

      const phrases = STATUS_PHRASES_BY_PHASE[nextPhase];
      for (const phrase of phrases) {
        if (block.text.includes(phrase)) {
          this.currentPhase = nextPhase;
          return nextPhase;
        }
      }
    }

    return null;
  }

  private getNextPhase(): (typeof PHASES_ORDER)[number] | null {
    if (this.currentPhase === 'setup') return '1.0-begin';
    const i = PHASES_ORDER.indexOf(this.currentPhase);
    if (i < 0 || i >= PHASES_ORDER.length - 1) return null;
    return PHASES_ORDER[i + 1];
  }

  reset(): void {
    this.currentPhase = 'setup';
  }
}
