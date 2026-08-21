import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/index';
import { getProgramConfig, Program } from '@lib/programs/program-registry';
import { metricsConfig } from '@lib/programs/metrics/index';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';

import { metricsCommand } from '../../../commands/metrics';

function staticRun(config: typeof metricsConfig): ProgramRun {
  if (typeof config.run === 'function') {
    throw new Error('expected a static ProgramRun, got a function');
  }
  if (!config.run) throw new Error('expected a ProgramRun');
  return config.run;
}

describe('metrics program', () => {
  it('is registered as a flat top-level `metrics` command', () => {
    const config = getProgramConfig('metrics');
    expect(config).toBe(metricsConfig);
    expect(config.command).toBe('metrics');
    expect(config.parentCommand).toBeUndefined();
    expect(Program.Metrics).toBe('metrics');
  });

  it('uses the agent-skill steps with a metrics-specific intro', () => {
    const [intro, ...rest] = metricsConfig.steps;
    expect(intro.id).toBe('intro');
    expect(intro.screenId).toBe('metrics-intro');
    expect(rest).toEqual(AGENT_SKILL_STEPS.slice(1));
  });

  it('runs the metrics agent flow on the orchestrator', () => {
    expect(metricsConfig.agentFlow).toBe('metrics');
  });

  it('runs the one collapsed metrics skill', () => {
    const run = staticRun(metricsConfig);
    expect(run.skillId).toBe('metrics');
    const prompt = run.customPrompt?.({} as WizardSession);
    expect(prompt).toContain('metrics');
    expect(prompt).toContain('installation reference');
  });

  it('points the outro at the metrics docs and report file', () => {
    const run = staticRun(metricsConfig);
    expect(run.docsUrl).toBe('https://posthog.com/docs/metrics');
    expect(run.reportFile).toBe('posthog-metrics-report.md');
    expect(metricsConfig.reportFile).toBe(run.reportFile);
  });

  it('is exposed as a yargs command via nativeCommandFactory', () => {
    expect(metricsCommand.name).toBe('metrics');
    expect(metricsCommand.description).toBe(metricsConfig.description);
    expect(typeof metricsCommand.handler).toBe('function');
  });
});
