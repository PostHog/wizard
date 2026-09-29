import { describe, expect, it } from 'vitest';
import { PROGRAM_REGISTRY } from '@programs';
import { AGENT_SKILL_STEPS } from '../shared/skill-flow';
import { getFlow } from '../index';

describe('program flows', () => {
  it('shows a health-check screen exactly for programs whose run checks readiness', () => {
    for (const config of PROGRAM_REGISTRY) {
      if (!config.run) continue;
      const hasScreen = getFlow(config.id).some(
        (step) => step.screenId === 'health-check',
      );
      expect(hasScreen, config.id).toBe(config.healthCheck !== false);
    }
  });

  it('metrics uses the agent-skill flow with its own intro', () => {
    const [intro, ...rest] = getFlow('metrics');
    expect(intro.id).toBe('intro');
    expect(intro.screenId).toBe('metrics-intro');
    expect(rest).toEqual(AGENT_SKILL_STEPS.slice(1));
  });

  it('error-tracking shows its intro and picks the project after login, before the run', () => {
    const flow = getFlow('error-tracking');
    const step = (id: string) => flow.find((s) => s.id === id);
    expect(step('intro')?.screenId).toBe('error-tracking-intro');
    const ids = flow.map((s) => s.id);
    expect(ids.indexOf('auth')).toBeLessThan(ids.indexOf('detect'));
    expect(ids.indexOf('detect')).toBeLessThan(ids.indexOf('run'));
    expect(step('detect')?.screenId).toBe('error-tracking-detect');
  });

  it('posthog-integration adds no steps for the warehouse suggestion', () => {
    expect(getFlow('posthog-integration').map((s) => s.id)).toEqual([
      'intro',
      'health-check',
      'setup',
      'auth',
      'run',
      'outro',
      'mcp',
      'slack-connect',
      'keep-skills',
    ]);
  });
});
