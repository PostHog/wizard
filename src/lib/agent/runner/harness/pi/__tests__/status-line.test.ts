/**
 * Pins the [STATUS] extraction that feeds the run spinner (see the message_end
 * handler in ../index). This is the wiring pi was missing entirely, so the
 * test guards against it silently regressing back to dropping status lines.
 */

import { describe, it, expect } from 'vitest';
import { AgentSignals } from '@lib/agent/signals';
import { lastStatusLine } from '..';

const S = AgentSignals.STATUS; // '[STATUS]'

describe('lastStatusLine', () => {
  it('extracts the phrase after the marker, trimmed of the marker and space', () => {
    expect(lastStatusLine(`${S} Reading the router entry`)).toBe(
      'Reading the router entry',
    );
  });

  it('finds the marker mid-block, ignoring surrounding prose lines', () => {
    const block = `Let me look at the entry point.\n${S} Adding the login capture\nDone.`;
    expect(lastStatusLine(block)).toBe('Adding the login capture');
  });

  it('returns the LAST marker when a turn prints several (freshest wins)', () => {
    const block = `${S} Installing SDK\n${S} Initializing PostHog\n${S} Instrumenting events`;
    expect(lastStatusLine(block)).toBe('Instrumenting events');
  });

  it('returns undefined when there is no marker', () => {
    expect(lastStatusLine('Just some assistant text, no status.')).toBe(
      undefined,
    );
  });

  it('returns undefined for a marker with no phrase after it', () => {
    expect(lastStatusLine(`${S}   `)).toBe(undefined);
  });
});
