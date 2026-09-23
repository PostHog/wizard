import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commitRegisteredRunSkillCleanups,
  registerRunSkillCleanup,
} from '../skill-run-cleanup';
import {
  clearCleanup,
  registerCleanup,
  runCleanups,
} from '@utils/cleanup-registry';

it('commits every registered skill directory without disarming unrelated cleanup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-cleanup-'));
  const extraDir = path.join(root, 'nested-project');
  const unrelated = vi.fn();
  try {
    const skillDirs = [root, extraDir].map((installDir) => {
      registerRunSkillCleanup(installDir);
      const skillDir = path.join(installDir, '.claude', 'skills', 'installed');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
      return skillDir;
    });
    registerCleanup(unrelated);

    commitRegisteredRunSkillCleanups();
    runCleanups();

    expect(skillDirs.every((skillDir) => fs.existsSync(skillDir))).toBe(true);
    expect(unrelated).toHaveBeenCalledOnce();
  } finally {
    commitRegisteredRunSkillCleanups();
    clearCleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
