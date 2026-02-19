import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveEnvPath,
  ensureGitignoreCoverage,
  parseEnvKeys,
  mergeEnvValues,
} from '../wizard-tools';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-tools-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// resolveEnvPath
// ---------------------------------------------------------------------------

describe('resolveEnvPath', () => {
  it('resolves a relative path within the working directory', () => {
    const result = resolveEnvPath('/project', '.env.local');
    expect(result).toBe(path.resolve('/project', '.env.local'));
  });

  it('resolves nested paths', () => {
    const result = resolveEnvPath('/project', 'config/.env');
    expect(result).toBe(path.resolve('/project', 'config/.env'));
  });

  it('rejects path traversal with ../', () => {
    expect(() => resolveEnvPath('/project', '../etc/passwd')).toThrow(
      'Path traversal rejected',
    );
  });

  it('rejects absolute paths outside working directory', () => {
    expect(() => resolveEnvPath('/project', '/etc/passwd')).toThrow(
      'Path traversal rejected',
    );
  });

  it('allows the working directory itself', () => {
    // edge case: filePath resolves to exactly workingDirectory
    expect(() => resolveEnvPath('/project', '.')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseEnvKeys
// ---------------------------------------------------------------------------

describe('parseEnvKeys', () => {
  it('parses simple KEY=value lines', () => {
    const keys = parseEnvKeys('FOO=bar\nBAZ=qux\n');
    expect(keys).toEqual(new Set(['FOO', 'BAZ']));
  });

  it('ignores comments', () => {
    const keys = parseEnvKeys('# COMMENT=ignored\nFOO=bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('ignores blank lines', () => {
    const keys = parseEnvKeys('\n\nFOO=bar\n\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('handles keys with leading whitespace', () => {
    const keys = parseEnvKeys('  FOO=bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('handles keys with spaces around =', () => {
    const keys = parseEnvKeys('FOO =bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('handles keys with underscores and numbers', () => {
    const keys = parseEnvKeys('MY_KEY_2=value\n');
    expect(keys).toEqual(new Set(['MY_KEY_2']));
  });

  it('returns empty set for empty content', () => {
    const keys = parseEnvKeys('');
    expect(keys).toEqual(new Set());
  });

  it('ignores lines without = sign', () => {
    const keys = parseEnvKeys('not a key value pair\nFOO=bar\n');
    expect(keys).toEqual(new Set(['FOO']));
  });

  it('parses keys with quoted values', () => {
    const keys = parseEnvKeys('FOO="bar baz"\nBAR=\'single\'\n');
    expect(keys).toEqual(new Set(['FOO', 'BAR']));
  });
});

// ---------------------------------------------------------------------------
// mergeEnvValues
// ---------------------------------------------------------------------------

describe('mergeEnvValues', () => {
  it('appends new keys to empty content', () => {
    const result = mergeEnvValues('', { FOO: 'bar' });
    expect(result).toBe('FOO=bar\n');
  });

  it('appends new keys to existing content', () => {
    const result = mergeEnvValues('EXISTING=val\n', { NEW: 'added' });
    expect(result).toBe('EXISTING=val\nNEW=added\n');
  });

  it('updates existing keys in-place', () => {
    const result = mergeEnvValues('FOO=old\nBAR=keep\n', { FOO: 'new' });
    expect(result).toBe('FOO=new\nBAR=keep\n');
  });

  it('handles mixed update and append', () => {
    const result = mergeEnvValues('FOO=old\n', {
      FOO: 'updated',
      BAR: 'new',
    });
    expect(result).toBe('FOO=updated\nBAR=new\n');
  });

  it('adds newline before appending if content lacks trailing newline', () => {
    const result = mergeEnvValues('FOO=bar', { BAZ: 'qux' });
    expect(result).toBe('FOO=bar\nBAZ=qux\n');
  });

  it('handles multiple new keys', () => {
    const result = mergeEnvValues('', { A: '1', B: '2', C: '3' });
    expect(result).toContain('A=1\n');
    expect(result).toContain('B=2\n');
    expect(result).toContain('C=3\n');
  });

  it('handles values containing = signs', () => {
    const result = mergeEnvValues('', {
      DB_URL: 'postgres://host:5432/db?opt=1',
    });
    expect(result).toBe('DB_URL=postgres://host:5432/db?opt=1\n');
  });

  it('updates a value containing = signs', () => {
    const result = mergeEnvValues('DB_URL=old://host\n', {
      DB_URL: 'postgres://new:5432/db?opt=1',
    });
    expect(result).toBe('DB_URL=postgres://new:5432/db?opt=1\n');
  });

  it('updates a key whose old value contains the key name', () => {
    const result = mergeEnvValues('FOO=FOO_old_value\n', { FOO: 'new' });
    expect(result).toBe('FOO=new\n');
  });
});

// ---------------------------------------------------------------------------
// ensureGitignoreCoverage
// ---------------------------------------------------------------------------

describe('ensureGitignoreCoverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('creates .gitignore if it does not exist', () => {
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('.env.local\n');
  });

  it('appends entry to existing .gitignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n.env.local\n');
  });

  it('appends with newline if .gitignore lacks trailing newline', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
    ensureGitignoreCoverage(tmpDir, '.env');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n.env\n');
  });

  it('does not duplicate an existing entry', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env.local\n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('.env.local\n');
  });

  it('handles entry with surrounding whitespace in .gitignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '  .env.local  \n');
    ensureGitignoreCoverage(tmpDir, '.env.local');
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    // Should not duplicate — the trim check should match
    expect(content).toBe('  .env.local  \n');
  });
});
