import { RunMetrics } from '@lib/agent/runner/sequence/orchestrator/run-metrics';

describe('RunMetrics', () => {
  it('reports time to first start and first completion from run start', () => {
    const m = new RunMetrics(0);
    m.recordStart(100);
    m.recordComplete(300);
    m.recordStart(1000);
    m.recordComplete(1100);
    const s = m.summary();
    expect(s.time_to_first_task_ms).toBe(100);
    expect(s.time_to_first_completion_ms).toBe(300);
  });

  it('max_gap_ms is the longest silence across all visible transitions', () => {
    const m = new RunMetrics(0);
    m.recordStart(100); // visible @100
    m.recordComplete(300); // gap 200
    m.recordStart(1000); // gap 700  ← longest
    m.recordComplete(1100); // gap 100
    expect(m.summary().max_gap_ms).toBe(700);
  });

  it('recordStart returns ms_since_run_start and the gap from the previous start', () => {
    const m = new RunMetrics(0);
    expect(m.recordStart(100)).toEqual({
      ms_since_run_start: 100,
      gap_since_prev_start_ms: undefined,
    });
    expect(m.recordStart(1000)).toEqual({
      ms_since_run_start: 1000,
      gap_since_prev_start_ms: 900,
    });
  });

  it('reports undefined timings for a run with no transitions, not zero', () => {
    const s = new RunMetrics(0).summary();
    expect(s.time_to_first_task_ms).toBeUndefined();
    expect(s.time_to_first_completion_ms).toBeUndefined();
    expect(s.max_gap_ms).toBeUndefined();
  });

  it('a single started-but-unfinished task reports a real zero gap and no completion', () => {
    const m = new RunMetrics(0);
    m.recordStart(50);
    const s = m.summary();
    expect(s.time_to_first_task_ms).toBe(50);
    expect(s.time_to_first_completion_ms).toBeUndefined();
    expect(s.max_gap_ms).toBe(0); // one visible transition → genuine 0, not undefined
  });

  it('counts a retry stall (start to re-start) as silence', () => {
    const m = new RunMetrics(0);
    m.recordStart(0);
    // the task ended without reporting and was requeued (invisible), then
    // re-started 5s later — that stall is a silence the user sees.
    m.recordStart(5000);
    expect(m.summary().max_gap_ms).toBe(5000);
  });

  it('treats skip and fail as visible transitions for gap tracking', () => {
    const m = new RunMetrics(0);
    m.recordStart(0);
    m.recordTerminal(2000); // skip or fail, gap 2000
    m.recordStart(2500); // gap 500
    expect(m.summary().max_gap_ms).toBe(2000);
  });
});
