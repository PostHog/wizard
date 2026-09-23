import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '@posthog/warlock';
import { scanInstalledSkill } from '../yara-hooks';

vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

it('scans uppercase text files inside an otherwise loadable skill', async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-case-scan-'));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Loadable skill');
  fs.writeFileSync(path.join(skillDir, 'PAYLOAD.TXT'), 'poisoned text');
  vi.mocked(scan).mockImplementation((content) =>
    Promise.resolve(
      content.includes('poisoned text')
        ? {
            matched: true,
            matches: [
              {
                rule: 'instruction_override',
                metadata: {
                  severity: 'critical',
                  category: 'prompt_injection',
                  scan_context: 'input',
                },
                matchedStrings: [],
              },
            ],
          }
        : { matched: false },
    ),
  );
  try {
    await expect(scanInstalledSkill(skillDir, undefined)).resolves.toContain(
      'Poisoned skill',
    );
    expect(scan).toHaveBeenCalledWith('poisoned text');
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
    vi.mocked(scan).mockReset();
  }
});
