import { describe, it, expect, vi } from 'vitest';
import {
  contentLeak,
  withContentGuard,
  pickEditContent,
  pickWriteContent,
  type LeakFinding,
} from '../content-guard';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

// The exact garbage run 9704a73e wrote into a customer's global-error.tsx.
const LEAKED_LINE =
  "' }#+#+#+#+.functions.complete_task  (commentary  json.functions.complete_taskjson>tagger历山大发 { ";

describe('contentLeak', () => {
  it('flags the observed transport-token leak with its evidence, not the content', () => {
    const finding = contentLeak(LEAKED_LINE);
    expect(finding?.label).toBe('leaked tool-call tokens');
    expect(finding?.token).toBe('"functions.complete_task"');
    expect(finding?.offset).toBe(LEAKED_LINE.indexOf('functions.'));
    expect(finding?.contentLength).toBe(LEAKED_LINE.length);
  });

  it('flags channel markers and control characters', () => {
    expect(contentLeak('x<|channel|>y')?.label).toBe('leaked channel markers');
    const ctl = contentLeak('trailing\x7f');
    expect(ctl?.label).toBe('control characters');
    expect(ctl?.token).toBe('"\\u007f"');
    expect(contentLeak('null\0byte')?.label).toBe('control characters');
  });

  it('passes real source content, including Firebase functions.* code', () => {
    expect(contentLeak('export default function GlobalError() {}')).toBe(
      undefined,
    );
    expect(contentLeak('const f = functions.https.onRequest(app);')).toBe(
      undefined,
    );
    expect(contentLeak('line one\n\ttabbed\r\nline two')).toBe(undefined);
  });
});

function makeTool() {
  const execute = vi.fn().mockResolvedValue({ content: [], details: {} });
  return { tool: { name: 'write', execute }, execute };
}

describe('withContentGuard (passive observation)', () => {
  it('observes a leaking write, reports it, and still executes', async () => {
    const { tool, execute } = makeTool();
    const leaks: LeakFinding[] = [];
    const guarded = withContentGuard(tool, pickWriteContent, (f) =>
      leaks.push(f),
    );
    await guarded.execute(
      ...([
        'id1',
        { content: LEAKED_LINE },
        undefined,
        undefined,
        {},
      ] as never[]),
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(leaks).toHaveLength(1);
    expect(leaks[0].label).toBe('leaked tool-call tokens');
  });

  it('passes clean writes through without reporting', async () => {
    const { tool, execute } = makeTool();
    const leaks: LeakFinding[] = [];
    const guarded = withContentGuard(tool, pickWriteContent, (f) =>
      leaks.push(f),
    );
    await guarded.execute(
      ...([
        'id1',
        { content: 'clean file\n' },
        undefined,
        undefined,
        {},
      ] as never[]),
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(leaks).toHaveLength(0);
  });

  it('observes edit newText but ignores oldText (repairs stay silent)', async () => {
    const { tool, execute } = makeTool();
    const leaks: LeakFinding[] = [];
    const guarded = withContentGuard(tool, pickEditContent, (f) =>
      leaks.push(f),
    );
    await guarded.execute(
      ...([
        'id1',
        { path: 'x.tsx', edits: [{ oldText: LEAKED_LINE, newText: '\n' }] },
        undefined,
        undefined,
        {},
      ] as never[]),
    );
    expect(leaks).toHaveLength(0);
    await guarded.execute(
      ...([
        'id2',
        { path: 'x.tsx', edits: [{ oldText: '\n', newText: LEAKED_LINE }] },
        undefined,
        undefined,
        {},
      ] as never[]),
    );
    expect(leaks).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('lets malformed params fall through to the tool own validation', async () => {
    const { tool, execute } = makeTool();
    const guarded = withContentGuard(tool, pickEditContent);
    await guarded.execute(
      ...([
        'id1',
        { edits: 'not-an-array' },
        undefined,
        undefined,
        {},
      ] as never[]),
    );
    expect(execute).toHaveBeenCalledOnce();
  });
});
