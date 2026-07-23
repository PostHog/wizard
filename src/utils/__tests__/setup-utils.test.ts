import * as childProcess from 'node:child_process';

import { getUncommittedOrUntrackedFiles } from '@utils/setup-utils';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn(),
}));

const execSync = vi.mocked(childProcess.execSync);

/** Build the NUL-separated payload `git status --porcelain=v1 -z` emits. */
const gitOutput = (...entries: string[]) =>
  entries.map((entry) => `${entry}\0`).join('');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUncommittedOrUntrackedFiles', () => {
  it('requests NUL-separated output so paths are never quoted or escaped', () => {
    execSync.mockReturnValue(Buffer.from(''));

    getUncommittedOrUntrackedFiles();

    expect(execSync).toHaveBeenCalledWith(
      'git status --porcelain=v1 -z',
      expect.anything(),
    );
  });

  it('returns an empty array when there is nothing to format', () => {
    execSync.mockReturnValue(Buffer.from(''));

    expect(getUncommittedOrUntrackedFiles()).toEqual([]);
  });

  it('returns an empty array when git fails', () => {
    execSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    expect(getUncommittedOrUntrackedFiles()).toEqual([]);
  });

  it('reads modified, staged, and untracked files', () => {
    execSync.mockReturnValue(
      Buffer.from(gitOutput(' M modified.ts', 'A  staged.ts', '?? new.ts')),
    );

    expect(getUncommittedOrUntrackedFiles()).toEqual([
      'modified.ts',
      'staged.ts',
      'new.ts',
    ]);
  });

  it('preserves paths containing spaces', () => {
    execSync.mockReturnValue(Buffer.from(gitOutput('?? with space.ts')));

    expect(getUncommittedOrUntrackedFiles()).toEqual(['with space.ts']);
  });

  it('preserves paths containing shell metacharacters', () => {
    execSync.mockReturnValue(
      Buffer.from(
        gitOutput('?? semi;colon.ts', '?? a.ts;>pwned', '?? $(whoami).ts'),
      ),
    );

    expect(getUncommittedOrUntrackedFiles()).toEqual([
      'semi;colon.ts',
      'a.ts;>pwned',
      '$(whoami).ts',
    ]);
  });

  it('preserves non-ASCII paths without C-quoting them', () => {
    execSync.mockReturnValue(Buffer.from(gitOutput('?? café.ts')));

    expect(getUncommittedOrUntrackedFiles()).toEqual(['café.ts']);
  });

  it('keeps the new path of a rename and drops the original', () => {
    // Rename entries are two fields: `R  <new>\0<old>\0`.
    execSync.mockReturnValue(
      Buffer.from(gitOutput('R  new name.ts', 'oldname.ts', '?? other.ts')),
    );

    expect(getUncommittedOrUntrackedFiles()).toEqual([
      'new name.ts',
      'other.ts',
    ]);
  });

  it('keeps the new path of a copy and drops the source', () => {
    execSync.mockReturnValue(
      Buffer.from(gitOutput('C  copy.ts', 'source.ts', '?? other.ts')),
    );

    expect(getUncommittedOrUntrackedFiles()).toEqual(['copy.ts', 'other.ts']);
  });

  it('skips deleted paths, which no longer exist on disk', () => {
    execSync.mockReturnValue(
      Buffer.from(
        gitOutput('D  staged delete.ts', ' D unstaged.ts', '?? kept.ts'),
      ),
    );

    expect(getUncommittedOrUntrackedFiles()).toEqual(['kept.ts']);
  });
});
