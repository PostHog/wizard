import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileDestination,
  createFileDestination,
} from '@lib/task-stream/destinations/file';
import { StreamEvent, type TaskStreamUpdate } from '@lib/task-stream/types';
import { WIZARD_TASK_STREAM_FILE } from '@utils/paths';
import { RunPhase } from '@lib/wizard-session';

const payload = (over: Partial<TaskStreamUpdate> = {}): TaskStreamUpdate => ({
  session_id: 'audit-audit-2026-01-01T00:00:00Z',
  workflow_id: 'audit',
  skill_id: 'audit',
  started_at: '2026-01-01T00:00:00Z',
  run_phase: RunPhase.Running,
  tasks: [],
  timestamp: '2026-01-01T00:00:01Z',
  ...over,
});

describe('FileDestination', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wizard-stream-log-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends one line per attempt, and holds one run per file', async () => {
    const path = join(dir, 'nested', 'stream.jsonl');
    writeFileSync(join(dir, 'stale.jsonl'), 'from an earlier run\n');

    const dest = new FileDestination({ path, now: () => 'AT' });
    await dest.send(StreamEvent.Create, payload());
    await dest.send(
      StreamEvent.Complete,
      payload({ skill_id: 'audit-events' }),
    );

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      at: 'AT',
      event: StreamEvent.Create,
      payload: payload(),
    });

    // A second run over the same path truncates rather than appending.
    const second = new FileDestination({ path });
    await second.send(StreamEvent.Create, payload());
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('never throws when the path is unwritable', async () => {
    const dest = new FileDestination({ path: dir });
    await expect(
      dest.send(StreamEvent.Create, payload()),
    ).resolves.toBeUndefined();
  });
});

describe('createFileDestination', () => {
  it('is off unless asked, and never writes in a published build', () => {
    expect(createFileDestination(undefined)).toBeNull();
    expect(createFileDestination(false)).toBeNull();
    expect(
      createFileDestination('/tmp/x.jsonl', { productionBuild: true }),
    ).toBeNull();
  });

  it('resolves the flag value to a path', () => {
    expect(createFileDestination('')?.path).toBe(WIZARD_TASK_STREAM_FILE);
    expect(
      createFileDestination('logs/run.jsonl', { cwd: '/tmp/project' })?.path,
    ).toBe('/tmp/project/logs/run.jsonl');
  });
});
