import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { captureException, wizardCapture } = vi.hoisted(() => ({
  captureException: vi.fn(),
  wizardCapture: vi.fn(),
}));

vi.mock('@utils/analytics', () => ({
  analytics: {
    captureException: (...args: unknown[]) => captureException(...args),
    wizardCapture: (...args: unknown[]) => wizardCapture(...args),
  },
}));

import {
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
  recoverOrphanedSettingsBackups,
} from '@lib/agent/claude-settings';

const SETTINGS = 'settings.json';
const BACKUP = 'settings.json.wizard-backup';

function makeProject(): { dir: string; claudeDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-settings-'));
  const claudeDir = path.join(dir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  return { dir, claudeDir };
}

describe('claude settings backup/restore', () => {
  let dir: string;
  let claudeDir: string;

  beforeEach(() => {
    captureException.mockClear();
    wizardCapture.mockClear();
    ({ dir, claudeDir } = makeProject());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const read = (name: string) =>
    fs.readFileSync(path.join(claudeDir, name), 'utf-8');
  const exists = (name: string) => fs.existsSync(path.join(claudeDir, name));

  describe('backupAndFixClaudeSettings', () => {
    it('moves the original aside and removes it so the SDK skips overrides', () => {
      fs.writeFileSync(path.join(claudeDir, SETTINGS), '{"apiKeyHelper":"x"}');

      const ok = backupAndFixClaudeSettings(dir);

      expect(ok).toBe(true);
      expect(exists(SETTINGS)).toBe(false);
      expect(read(BACKUP)).toBe('{"apiKeyHelper":"x"}');
      expect(captureException).not.toHaveBeenCalled();
    });

    it('returns false and stays silent when there is nothing to back up', () => {
      const ok = backupAndFixClaudeSettings(dir);

      expect(ok).toBe(false);
      expect(captureException).not.toHaveBeenCalled();
    });

    it('does not clobber a backup an earlier call already wrote', () => {
      fs.writeFileSync(path.join(claudeDir, BACKUP), '{"pristine":true}');
      fs.writeFileSync(path.join(claudeDir, SETTINGS), '{"modified":true}');

      backupAndFixClaudeSettings(dir);

      expect(read(BACKUP)).toBe('{"pristine":true}');
      expect(exists(SETTINGS)).toBe(false);
    });

    it('mirrors the source file mode on the backup so 0600 stays 0600', () => {
      const settingsPath = path.join(claudeDir, SETTINGS);
      fs.writeFileSync(settingsPath, '{"apiKeyHelper":"secret"}');
      fs.chmodSync(settingsPath, 0o600);

      backupAndFixClaudeSettings(dir);

      const backupMode = fs.statSync(path.join(claudeDir, BACKUP)).mode & 0o777;
      expect(backupMode).toBe(0o600);
    });

    it("adds *.wizard-backup to .claude/.gitignore so orphans can't be committed", () => {
      fs.writeFileSync(path.join(claudeDir, SETTINGS), '{"apiKeyHelper":"x"}');

      backupAndFixClaudeSettings(dir);

      const gitignore = fs.readFileSync(
        path.join(claudeDir, '.gitignore'),
        'utf-8',
      );
      expect(gitignore).toContain('*.wizard-backup');
    });

    it('does not duplicate the gitignore entry on repeat backups', () => {
      const gitignorePath = path.join(claudeDir, '.gitignore');
      fs.writeFileSync(gitignorePath, '*.wizard-backup\n');
      fs.writeFileSync(path.join(claudeDir, SETTINGS), '{"apiKeyHelper":"x"}');

      backupAndFixClaudeSettings(dir);

      const lines = fs
        .readFileSync(gitignorePath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim() === '*.wizard-backup');
      expect(lines).toHaveLength(1);
    });

    it('appends to an existing .gitignore without a trailing newline', () => {
      const gitignorePath = path.join(claudeDir, '.gitignore');
      fs.writeFileSync(gitignorePath, 'foo');
      fs.writeFileSync(path.join(claudeDir, SETTINGS), '{"apiKeyHelper":"x"}');

      backupAndFixClaudeSettings(dir);

      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignore).toBe('foo\n*.wizard-backup\n');
    });
  });

  describe('restoreClaudeSettings', () => {
    it('puts the original back and removes the backup', () => {
      fs.writeFileSync(path.join(claudeDir, BACKUP), '{"apiKeyHelper":"x"}');

      restoreClaudeSettings(dir);

      expect(read(SETTINGS)).toBe('{"apiKeyHelper":"x"}');
      expect(exists(BACKUP)).toBe(false);
      expect(wizardCapture).toHaveBeenCalledWith('restored-claude-settings');
    });

    it('is a silent no-op when no backup exists (the clean-run case)', () => {
      restoreClaudeSettings(dir);

      expect(captureException).not.toHaveBeenCalled();
      expect(wizardCapture).not.toHaveBeenCalledWith(
        'restored-claude-settings',
      );
    });

    it('is idempotent across repeated calls (outro then cleanup)', () => {
      fs.writeFileSync(path.join(claudeDir, BACKUP), '{"a":1}');

      restoreClaudeSettings(dir);
      restoreClaudeSettings(dir);

      expect(read(SETTINGS)).toBe('{"a":1}');
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe('recoverOrphanedSettingsBackups', () => {
    it('restores a backup orphaned by an interrupted run (backup, no original)', () => {
      fs.writeFileSync(path.join(claudeDir, BACKUP), '{"orphaned":true}');

      recoverOrphanedSettingsBackups(dir);

      expect(read(SETTINGS)).toBe('{"orphaned":true}');
      expect(exists(BACKUP)).toBe(false);
      expect(wizardCapture).toHaveBeenCalledWith('recovered-orphaned-settings');
    });

    it('leaves things alone when the original is still present', () => {
      fs.writeFileSync(path.join(claudeDir, BACKUP), '{"backup":true}');
      fs.writeFileSync(path.join(claudeDir, SETTINGS), '{"current":true}');

      recoverOrphanedSettingsBackups(dir);

      expect(read(SETTINGS)).toBe('{"current":true}');
      expect(read(BACKUP)).toBe('{"backup":true}');
      expect(wizardCapture).not.toHaveBeenCalledWith(
        'recovered-orphaned-settings',
      );
    });

    it('is a no-op when there is no backup at all', () => {
      recoverOrphanedSettingsBackups(dir);

      expect(captureException).not.toHaveBeenCalled();
      expect(exists(SETTINGS)).toBe(false);
    });
  });

  describe('full interrupted-run lifecycle', () => {
    it('a backup then crash then next-run recovery restores the user file', () => {
      fs.writeFileSync(
        path.join(claudeDir, SETTINGS),
        '{"apiKeyHelper":"real"}',
      );

      // Run 1: back up, then the process is killed before restore.
      expect(backupAndFixClaudeSettings(dir)).toBe(true);
      expect(exists(SETTINGS)).toBe(false);
      expect(exists(BACKUP)).toBe(true);

      // Run 2: startup recovery heals the orphan.
      recoverOrphanedSettingsBackups(dir);

      expect(read(SETTINGS)).toBe('{"apiKeyHelper":"real"}');
      expect(exists(BACKUP)).toBe(false);
      expect(captureException).not.toHaveBeenCalled();
    });
  });
});
