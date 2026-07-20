import { applyManualSteps } from '../outro';
import { OutroKind, type OutroData } from '@lib/wizard-session';

const success: OutroData = {
  kind: OutroKind.Success,
  message: 'MCP analytics configured!',
};

describe('applyManualSteps', () => {
  it('adds a single manual step as a nextSteps section on a success outro', () => {
    const out = applyManualSteps(success, [
      'Run `pnpm add @posthog/mcp posthog-node` to finish.',
    ]);

    expect(out).toMatchObject({
      kind: OutroKind.Success,
      message: 'Almost done. One step left.',
      nextSteps: {
        heading: 'One step left',
        items: ['Run `pnpm add @posthog/mcp posthog-node` to finish.'],
      },
    });
  });

  it('pluralizes the heading and message for multiple steps', () => {
    const out = applyManualSteps(success, ['Install the SDK.', 'Restart.']);

    expect(out?.message).toBe('Almost done. A few steps left.');
    expect(out?.nextSteps).toEqual({
      heading: 'Steps left',
      items: ['Install the SDK.', 'Restart.'],
    });
  });

  it('prepends manual steps to an outro that already has nextSteps', () => {
    const withSteps: OutroData = {
      ...success,
      nextSteps: { heading: 'Next up', items: ['Explore your dashboard'] },
    };
    const out = applyManualSteps(withSteps, ['Install the SDK.']);

    expect(out?.nextSteps).toEqual({
      heading: 'Next up',
      items: ['Install the SDK.', 'Explore your dashboard'],
    });
  });

  it('is a no-op with no steps', () => {
    expect(applyManualSteps(success, [])).toBe(success);
    expect(applyManualSteps(success, undefined)).toBe(success);
  });

  it('leaves a non-success outro untouched', () => {
    const errorOutro: OutroData = {
      kind: OutroKind.Error,
      message: 'Something failed',
    };
    expect(applyManualSteps(errorOutro, ['Do a thing'])).toBe(errorOutro);
  });

  it('handles an undefined outro', () => {
    expect(applyManualSteps(undefined, ['Do a thing'])).toBeUndefined();
  });
});
