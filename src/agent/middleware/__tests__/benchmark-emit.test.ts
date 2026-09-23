import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProgress } from '@agent/progress';

// The benchmark pipeline runs inside the agent, which has no UI. Reaching one
// is the defect this file guards against.
vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('agent code reached the UI');
  },
}));
vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
  configureLogFile: vi.fn(),
  getLogFilePath: () => '/tmp/wizard.log',
}));

import { createBenchmarkPipeline } from '../benchmark';
import { getDefaultConfig } from '../config';

describe('createBenchmarkPipeline', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wizard-benchmark-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports every benchmark line as a progress event and never touches the UI', () => {
    const events: AgentProgress[] = [];
    const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
    const config = getDefaultConfig();
    config.output.benchmarkPath = join(dir, 'benchmark.json');
    config.output.logPath = join(dir, 'wizard.log');
    config.output.logEnabled = false;

    const pipeline = createBenchmarkPipeline(
      (event) => events.push(event),
      spinner,
      {
        installDir: dir,
        ci: false,
        debug: false,
        benchmark: true,
        yaraReport: false,
        signup: false,
      },
      config,
    );
    pipeline.onMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    });
    pipeline.finalize({ type: 'result', modelUsage: {}, num_turns: 1 }, 1500);

    const logs = events.flatMap((event) =>
      event.kind === 'log' ? [event.message] : [],
    );
    expect(logs[0]).toContain('Verbose logs: /tmp/wizard.log');
    expect(logs[1]).toContain(
      `Benchmark data will be written to: ${config.output.benchmarkPath}`,
    );
    expect(logs.some((line) => line.includes('Summary by phase'))).toBe(true);
    expect(logs.at(-1)).toContain(
      `Results written to ${config.output.benchmarkPath}`,
    );
    expect(events.every((event) => event.kind === 'log')).toBe(true);
    expect(existsSync(config.output.benchmarkPath)).toBe(true);
  });

  it('stays quiet when the config suppresses wizard logs', () => {
    const events: AgentProgress[] = [];
    const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
    const config = getDefaultConfig();
    config.output.benchmarkPath = join(dir, 'benchmark.json');
    config.output.logPath = join(dir, 'wizard.log');
    config.output.logEnabled = false;
    config.output.suppressWizardLogs = true;

    const pipeline = createBenchmarkPipeline(
      (event) => events.push(event),
      spinner,
      {
        installDir: dir,
        ci: false,
        debug: false,
        benchmark: true,
        yaraReport: false,
        signup: false,
      },
      config,
    );
    pipeline.finalize({ type: 'result', modelUsage: {} }, 10);

    const logs = events.flatMap((event) =>
      event.kind === 'log' ? [event.message] : [],
    );
    // Only the JSON writer speaks; the summary plugin is disabled by the flag.
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('Results written to');
  });
});
