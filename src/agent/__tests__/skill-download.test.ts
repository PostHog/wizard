import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipSync } from 'fflate';
import { scanInstalledSkill } from '@agent/yara-hooks';
import { downloadSkill } from '@agent/tools/tools';
import { analytics } from '@utils/analytics';

vi.mock('@agent/yara-hooks', () => ({ scanInstalledSkill: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

const entry = {
  id: 'dummy',
  name: 'Dummy',
  downloadUrl: 'https://example.test/dummy.zip',
};

describe('downloadSkill file ownership', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-skill-download-'),
    );
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            zipSync({
              'SKILL.md': new TextEncoder().encode('# downloaded'),
              'NEW.md': new TextEncoder().encode('new file'),
            }),
            { status: 200 },
          ),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('removes only downloaded files and restores overwritten files on poison', async () => {
    const skillDir = path.join(installDir, '.claude', 'skills', entry.id);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# original');
    fs.writeFileSync(path.join(skillDir, 'USER.md'), 'keep me');
    vi.mocked(scanInstalledSkill).mockResolvedValueOnce('Poisoned skill');

    const result = await downloadSkill(entry, installDir, {
      triage: undefined,
    });

    expect(result).toEqual({ success: false, error: 'Poisoned skill' });
    expect(scanInstalledSkill).toHaveBeenCalledExactlyOnceWith(
      skillDir,
      undefined,
    );
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      '# original',
    );
    expect(fs.readFileSync(path.join(skillDir, 'USER.md'), 'utf8')).toBe(
      'keep me',
    );
    expect(fs.existsSync(path.join(skillDir, 'NEW.md'))).toBe(false);
    expect(fs.existsSync(path.join(skillDir, '.posthog-wizard'))).toBe(false);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'skill install failed',
      expect.objectContaining({ skill_id: entry.id, step: 'scan' }),
    );
  });

  it('scans an alternate skills root before reporting success', async () => {
    vi.mocked(scanInstalledSkill).mockResolvedValueOnce(null);
    const skillDir = path.join(installDir, 'skills', entry.id);

    const result = await downloadSkill(entry, installDir, {
      skillsRoot: 'skills',
      triage: undefined,
    });

    expect(result).toEqual({ success: true });
    expect(scanInstalledSkill).toHaveBeenCalledExactlyOnceWith(
      skillDir,
      undefined,
    );
    expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe(
      '# downloaded',
    );
    expect(fs.existsSync(path.join(skillDir, '.posthog-wizard'))).toBe(true);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'skill installed',
      expect.objectContaining({ skill_id: entry.id }),
    );
  });
});
