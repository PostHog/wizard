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
  it('flags the observed transport-token leak', () => {
    expect(contentLeak(LEAKED_LINE)).toBe('leaked tool-call tokens');
  });

  it('flags channel markers and control characters', () => {
    expect(contentLeak('x<|channel|>y')).toBe('leaked channel markers');
    expect(contentLeak('trailing\x7f')).toBe('control characters');
    expect(contentLeak('null\0byte')).toBe('control characters');
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
