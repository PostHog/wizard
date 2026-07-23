/**
 * The anthropic harness retries on the default model when the gateway
 * plan-gates the requested one (403 → MODEL_PLAN_GATED). This guards the
 * free-tier onboarding path: a task routed to a plan-excluded model (e.g.
 * opus) must fall back rather than dying with a misleading auth error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_AGENT_MODEL, OPUS_MODEL } from '@lib/constants';
import { AgentErrorType } from '@lib/agent/agent-interface';
import type { AgentRunConfig } from '@lib/agent/agent-interface';
import { runWithPlanFallback } from '../index';

const captured: Array<{ event: string; props?: Record<string, unknown> }> = [];
vi.mock('@utils/analytics', () => ({
  analytics: {
    wizardCapture: (event: string, props?: Record<string, unknown>) =>
      captured.push({ event, props }),
  },
}));

/** A bare config carrying just the model the fallback reads. */
const agentWith = (model: string) => ({ model } as AgentRunConfig);

beforeEach(() => {
  captured.length = 0;
});

describe('runWithPlanFallback', () => {
  it('retries on the default model when the requested model is plan-gated', async () => {
    const models: (string | undefined)[] = [];
    const run = vi.fn((a: AgentRunConfig) => {
      models.push(a.model);
      return Promise.resolve(
        a.model === OPUS_MODEL
          ? {
              error: AgentErrorType.MODEL_PLAN_GATED,
              message: 'API Error: 403',
            }
          : {},
      );
    });

    const result = await runWithPlanFallback(agentWith(OPUS_MODEL), run);

    expect(result).toEqual({});
    expect(models).toEqual([OPUS_MODEL, DEFAULT_AGENT_MODEL]);
    expect(captured.map((c) => c.event)).toContain('agent model plan fallback');
  });

  it('does not retry when already on the default model', async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        error: AgentErrorType.MODEL_PLAN_GATED,
        message: 'API Error: 403',
      }),
    );

    const result = await runWithPlanFallback(
      agentWith(DEFAULT_AGENT_MODEL),
      run,
    );

    expect(result.error).toBe(AgentErrorType.MODEL_PLAN_GATED);
    expect(run).toHaveBeenCalledTimes(1);
    expect(captured.map((c) => c.event)).not.toContain(
      'agent model plan fallback',
    );
  });

  it('surfaces the plan-gated error when the fallback also fails', async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        error: AgentErrorType.MODEL_PLAN_GATED,
        message: 'API Error: 403',
      }),
    );

    const result = await runWithPlanFallback(agentWith(OPUS_MODEL), run);

    expect(result.error).toBe(AgentErrorType.MODEL_PLAN_GATED);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a non-plan-gated error', async () => {
    const run = vi.fn(() =>
      Promise.resolve({
        error: AgentErrorType.API_ERROR,
        message: 'API Error: 500',
      }),
    );

    const result = await runWithPlanFallback(agentWith(OPUS_MODEL), run);

    expect(result.error).toBe(AgentErrorType.API_ERROR);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not retry on success', async () => {
    const run = vi.fn(() => Promise.resolve({}));

    const result = await runWithPlanFallback(agentWith(OPUS_MODEL), run);

    expect(result).toEqual({});
    expect(run).toHaveBeenCalledTimes(1);
  });
});
