import { randomUUID } from 'node:crypto';
import type { ProgramId } from '../programs/program-registry.js';
import type { ControlState, RunRecord } from './types.js';

/** Thrown when a run is requested while one is in flight. Maps to 409. */
export class RunInFlightError extends Error {
  constructor(runId: string) {
    super(`A run is already in flight: ${runId}`);
    this.name = 'RunInFlightError';
  }
}

/** Every independent run this process served, in start order. */
export class RunLedger {
  private readonly records: RunRecord[] = [];

  get active(): RunRecord | null {
    return this.records.find((r) => r.status === 'running') ?? null;
  }

  start(programId: ProgramId, installDir: string): RunRecord {
    const running = this.active;
    if (running) throw new RunInFlightError(running.runId);
    const record: RunRecord = {
      runId: randomUUID(),
      programId,
      installDir,
      status: 'running',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
    };
    this.records.push(record);
    return record;
  }

  finish(runId: string, result: ControlState): void {
    const record = this.find(runId);
    record.status = 'done';
    record.result = result;
    record.finishedAt = new Date().toISOString();
  }

  fail(runId: string, error: string, result: ControlState): void {
    const record = this.find(runId);
    record.status = 'failed';
    record.error = error;
    record.result = result;
    record.finishedAt = new Date().toISOString();
  }

  list(): RunRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  private find(runId: string): RunRecord {
    const record = this.records.find((r) => r.runId === runId);
    if (!record) throw new Error(`unknown run ${runId}`);
    return record;
  }
}
