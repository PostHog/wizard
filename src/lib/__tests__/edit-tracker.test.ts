import {
  recordEditedFile,
  getEditedFiles,
  resetEditedFiles,
  createPostToolUseEditTrackerHooks,
} from '@lib/edit-tracker';

type HookInput = Record<string, unknown>;

const runHook = (input: HookInput): Promise<Record<string, unknown>> =>
  createPostToolUseEditTrackerHooks()[0].hooks[0](input, undefined, {
    signal: new AbortController().signal,
  });

describe('edit-tracker', () => {
  beforeEach(() => resetEditedFiles());

  it('records, de-duplicates, and sorts edited files', () => {
    recordEditedFile('/proj/b.tsx');
    recordEditedFile('/proj/a.tsx');
    recordEditedFile('/proj/b.tsx');
    expect(getEditedFiles()).toEqual(['/proj/a.tsx', '/proj/b.tsx']);
  });

  it('ignores empty paths', () => {
    recordEditedFile('');
    expect(getEditedFiles()).toEqual([]);
  });

  it('resets state', () => {
    recordEditedFile('/proj/a.tsx');
    resetEditedFiles();
    expect(getEditedFiles()).toEqual([]);
  });

  describe('PostToolUse hook', () => {
    it('records file_path for Write, Edit, and MultiEdit', async () => {
      await runHook({
        tool_name: 'Write',
        tool_input: { file_path: '/p/x.tsx' },
      });
      await runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/p/y.tsx' },
      });
      await runHook({
        tool_name: 'MultiEdit',
        tool_input: { file_path: '/p/z.tsx' },
      });
      expect(getEditedFiles()).toEqual(['/p/x.tsx', '/p/y.tsx', '/p/z.tsx']);
    });

    it('ignores non-editing tools', async () => {
      await runHook({
        tool_name: 'Read',
        tool_input: { file_path: '/p/x.tsx' },
      });
      await runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
      expect(getEditedFiles()).toEqual([]);
    });

    it('tolerates a missing file_path', async () => {
      await runHook({ tool_name: 'Write', tool_input: {} });
      expect(getEditedFiles()).toEqual([]);
    });
  });
});
