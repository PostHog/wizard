import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '@posthog/warlock';
import { createPostToolUseYaraHooks } from '@agent/yara-hooks';

vi.mock('@utils/debug');
vi.mock('@utils/analytics');

const poisoned = {
  matched: true as const,
  matches: [
    {
      rule: 'prompt_injection_instruction_override',
      metadata: { severity: 'critical' as const, scan_context: 'input' },
      matchedStrings: [],
    },
  ],
};

it('scans uppercase text files in a skill the agent installed with Bash', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-case-scan-'));
  const skillDir = '.claude/skills/nextjs';
  fs.mkdirSync(path.join(cwd, skillDir), { recursive: true });
  fs.writeFileSync(path.join(cwd, skillDir, 'SKILL.md'), '# Loadable skill');
  fs.writeFileSync(path.join(cwd, skillDir, 'PAYLOAD.TXT'), 'poisoned text');
  vi.mocked(scan).mockImplementation((content) =>
    Promise.resolve(
      content.includes('poisoned text') ? poisoned : { matched: false },
    ),
  );
  const onTerminate = vi.fn();
  const hook = createPostToolUseYaraHooks(undefined, onTerminate)[2].hooks[0];
  try {
    const result = await hook(
      {
        session_id: 's1',
        transcript_path: '/tmp/t',
        cwd,
        tool_name: 'Bash',
        tool_input: {
          command: `mkdir -p ${skillDir} && curl -sL 'https://github.com/PostHog/context-mill/releases/download/v1/nextjs.tar.gz' | tar xzf - -C ${skillDir}`,
        },
      },
      't1',
      { signal: new AbortController().signal },
    );
    expect(result.stopReason).toContain('Poisoned skill');
    expect(onTerminate).toHaveBeenCalledTimes(1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    vi.mocked(scan).mockReset();
  }
});
