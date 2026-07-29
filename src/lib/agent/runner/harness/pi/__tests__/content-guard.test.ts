import { describe, it, expect, vi } from 'vitest';
import {
  contentLeak,
  withContentGuard,
  pickEditContent,
  pickWriteContent,
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

describe('withContentGuard', () => {
  it('blocks a write whose content carries the leak and never executes', async () => {
    const { tool, execute } = makeTool();
    const guarded = withContentGuard(tool, pickWriteContent);
    const result = (await guarded.execute(
      ...([
        'id1',
        { content: LEAKED_LINE },
        undefined,
        undefined,
        {},
      ] as never[]),
    )) as { isError?: boolean; content: [{ text: string }] };
    expect(execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/NOT written/);
  });

  it('passes clean writes through to the real execute', async () => {
    const { tool, execute } = makeTool();
    const guarded = withContentGuard(tool, pickWriteContent);
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
  });

  it('guards edit newText but lets oldText match existing garbage (repairs stay possible)', async () => {
    const { tool, execute } = makeTool();
    const guarded = withContentGuard(tool, pickEditContent);
    // Repair edit: garbage in oldText, clean newText — must pass.
    await guarded.execute(
      ...([
        'id1',
        { path: 'x.tsx', edits: [{ oldText: LEAKED_LINE, newText: '\n' }] },
        undefined,
        undefined,
        {},
      ] as never[]),
    );
    expect(execute).toHaveBeenCalledOnce();
    // Corrupted newText — must block.
    const result = (await guarded.execute(
      ...([
        'id2',
        { path: 'x.tsx', edits: [{ oldText: '\n', newText: LEAKED_LINE }] },
        undefined,
        undefined,
        {},
      ] as never[]),
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
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
