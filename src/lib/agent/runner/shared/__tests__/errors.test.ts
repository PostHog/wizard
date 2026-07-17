import { resolveAbortOutcome } from '../errors';
import { WizardError } from '@utils/wizard-abort';
import { OutroKind } from '@lib/wizard-session';
import type { AbortCase } from '../types';

const ABORT_CASES: AbortCase[] = [
  {
    match: /^no mcp server found$/i,
    message: 'No MCP server found',
    body: 'This command instruments an existing MCP server.',
    docsUrl: 'https://posthog.com/docs/mcp-analytics',
  },
  {
    match: /^not a javascript mcp server$/i,
    message: 'Not a JavaScript/TypeScript MCP server',
    body: 'MCP analytics is currently TypeScript/JavaScript-only.',
  },
];

const config = {
  abortCases: ABORT_CASES,
  integrationLabel: 'mcp-analytics',
  docsUrl: 'https://posthog.com/docs',
};

describe('resolveAbortOutcome', () => {
  it('does NOT report a matched (expected) abort to error tracking', () => {
    const { outroData, error, matched } = resolveAbortOutcome(
      'no mcp server found',
      config,
    );

    // The whole point of the fix: expected user conditions carry no error.
    expect(error).toBeUndefined();
    expect(matched).toBe(ABORT_CASES[0]);
    expect(outroData).toEqual({
      kind: OutroKind.Error,
      message: 'No MCP server found',
      body: 'This command instruments an existing MCP server.',
      docsUrl: 'https://posthog.com/docs/mcp-analytics',
    });
  });

  it('matches case-insensitively and uses the first matching case', () => {
    const { error, matched } = resolveAbortOutcome(
      'NOT A JAVASCRIPT MCP SERVER',
      config,
    );

    expect(error).toBeUndefined();
    expect(matched).toBe(ABORT_CASES[1]);
  });

  it('reports an unrecognized abort as a WizardError with context', () => {
    const { outroData, error, matched } = resolveAbortOutcome(
      'something genuinely unexpected',
      config,
    );

    expect(matched).toBeUndefined();
    expect(error).toBeInstanceOf(WizardError);
    expect(error?.message).toBe(
      'Agent aborted: something genuinely unexpected',
    );
    expect((error as WizardError).context).toMatchObject({
      integration: 'mcp-analytics',
      reason: 'something genuinely unexpected',
    });
    expect(outroData).toMatchObject({
      kind: OutroKind.Error,
      message: 'mcp-analytics aborted',
      body: 'something genuinely unexpected',
      docsUrl: 'https://posthog.com/docs',
    });
  });

  it('falls back to a generic body when an unrecognized abort has no reason', () => {
    const { error, outroData } = resolveAbortOutcome('', config);

    expect(error).toBeInstanceOf(WizardError);
    expect(outroData).toMatchObject({
      body: 'The agent aborted the program.',
    });
  });

  it('reports as an error when a program declares no abort cases', () => {
    const { error, matched } = resolveAbortOutcome('no mcp server found', {
      integrationLabel: 'nextjs',
      docsUrl: 'https://posthog.com/docs',
    });

    expect(matched).toBeUndefined();
    expect(error).toBeInstanceOf(WizardError);
  });
});
