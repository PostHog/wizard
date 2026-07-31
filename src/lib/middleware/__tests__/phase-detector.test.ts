import { describe, it, expect } from 'vitest';
import { PhaseDetector } from '../phase-detector';

/** Minimal assistant SDK message carrying a single text block. */
function assistantText(text: string): any {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}

/** Feed a stream of status texts and collect the phase transitions emitted. */
function runPhases(detector: PhaseDetector, statusLines: string[]): string[] {
  const transitions: string[] = [];
  for (const line of statusLines) {
    const phase = detector.detect(assistantText(`[STATUS] ${line}`));
    if (phase) transitions.push(phase);
  }
  return transitions;
}

describe('PhaseDetector', () => {
  it('walks the logs skill through its seven step phases in order', () => {
    const detector = new PhaseDetector('logs');
    const transitions = runPhases(detector, [
      'Detecting application runtime',
      'Finding existing logging',
      'Resolving ingestion region',
      'Adding OpenTelemetry packages',
      'Mapping log emitting surfaces',
      'Configuring client to send identity headers',
      'Adding correlation to the logging pipeline',
      'Running build',
      'Writing logs setup report',
    ]);

    expect(transitions).toEqual([
      '1-detect',
      '2-install',
      '3-plan',
      '4-context',
      '5-attach',
      '6-verify',
      '7-report',
    ]);
  });

  it('advances only once per phase even with repeated status lines', () => {
    const detector = new PhaseDetector('logs');
    const transitions = runPhases(detector, [
      'Detecting application runtime',
      'Finding existing logging',
      'Checking for PostHog SDKs',
      'Resolving ingestion region',
    ]);
    expect(transitions).toEqual(['1-detect', '2-install']);
  });

  it('ignores non-assistant messages and text without [STATUS]', () => {
    const detector = new PhaseDetector('logs');
    expect(detector.detect({ type: 'user' })).toBeNull();
    expect(
      detector.detect(assistantText('Detecting application runtime')),
    ).toBeNull();
  });

  it('still recognizes the core integration phases by default', () => {
    const detector = new PhaseDetector('posthog-integration');
    const transitions = runPhases(detector, [
      'Checking project structure',
      'Inserting PostHog capture code',
      'Linting, building and prettying',
      'Created setup report',
    ]);
    expect(transitions).toEqual([
      '1.0-begin',
      '1.1-edit',
      '1.2-revise',
      '1.3-conclude',
    ]);
  });

  it('falls back to integration phases for an unknown program', () => {
    const detector = new PhaseDetector('some-unmapped-program');
    const transitions = runPhases(detector, [
      'Checking project structure',
      'Inserting PostHog capture code',
    ]);
    expect(transitions).toEqual(['1.0-begin', '1.1-edit']);
  });
});
