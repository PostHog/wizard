import { config as metricsConfig } from '../index';
import type { ProgramRun } from '@programs/program-run';

function staticRun(config: typeof metricsConfig): ProgramRun {
  if (typeof config.run === 'function') {
    throw new Error('expected a static ProgramRun, got a function');
  }
  if (!config.run) throw new Error('expected a ProgramRun');
  return config.run;
}

describe('metrics program', () => {
  it('runs the metrics agent flow', () => {
    expect(metricsConfig.agentFlow).toBe('metrics');
  });

  it('has no fixed skillId — the agent picks the variant from the menu', () => {
    const run = staticRun(metricsConfig);
    expect(run.skillId).toBeUndefined();

    const prompt = run.customPrompt?.({} as never);
    expect(prompt).toContain('load_skill_menu');
    expect(prompt).toContain('"metrics"');
    // Every published variant the prompt teaches the agent to choose from.
    for (const variant of [
      'metrics-python',
      'metrics-nodejs',
      'metrics-javascript',
      'metrics-kubernetes',
      'metrics-other',
    ]) {
      expect(prompt).toContain(variant);
    }
  });

  it('points the outro at the metrics docs and report file', () => {
    const run = staticRun(metricsConfig);
    expect(run.docsUrl).toBe('https://posthog.com/docs/metrics');
    expect(run.reportFile).toBe('posthog-metrics-report.md');
    expect(metricsConfig.reportFile).toBe(run.reportFile);
  });
});
