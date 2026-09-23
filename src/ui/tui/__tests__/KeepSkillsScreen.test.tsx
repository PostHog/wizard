import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WizardStore } from '../store';
import { KeepSkillsScreen } from '../screens/KeepSkillsScreen';
import { KeyboardHintsProvider } from '../hooks/useKeyboardHints';
import { buildSession } from '@lib/wizard-session';

vi.mock('ink', () =>
  vi.importActual('../../../../node_modules/ink/build/index.js'),
);

let installDir: string;
const skillDir = (name: string) =>
  path.join(installDir, '.claude', 'skills', name);

/** A wizard skill whose marker was written at `writtenAt`. */
function installSkill(name: string, writtenAt: Date) {
  fs.mkdirSync(skillDir(name), { recursive: true });
  fs.writeFileSync(path.join(skillDir(name), 'SKILL.md'), '# skill');
  const marker = path.join(skillDir(name), '.posthog-wizard');
  fs.writeFileSync(marker, '');
  fs.utimesSync(marker, writtenAt, writtenAt);
}

function setup() {
  const store = new WizardStore();
  store.session = buildSession({ installDir });
  const app = render(
    <KeyboardHintsProvider>
      <KeepSkillsScreen store={store} />
    </KeyboardHintsProvider>,
  );
  const asked = () =>
    vi.waitFor(() => expect(app.lastFrame()).toContain('Remove [Esc]'));
  return { store, app, asked };
}

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-skills-'));
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  installSkill('kept-last-time', new Date('2026-09-01T00:00:00Z'));
  installSkill('integration-javascript_node', new Date());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fs.rmSync(installDir, { recursive: true, force: true });
});

it('lists only the skills this run installed, nested under skills/', async () => {
  const { app, asked } = setup();
  await asked();
  const frame = app.lastFrame() ?? '';
  expect(frame).not.toContain('kept-last-time');
  expect(frame).toContain(
    [
      '.claude/',
      '    skills/',
      '      integration-javascript_node/',
      '        SKILL.md',
    ].join('\n'),
  );
});

it('removes only the skills this run installed', async () => {
  const { app, asked } = setup();
  await asked();
  app.stdin.write('\u001B'); // Remove [Esc]
  await vi.waitFor(() =>
    expect(fs.existsSync(skillDir('integration-javascript_node'))).toBe(false),
  );
  expect(fs.existsSync(skillDir('kept-last-time'))).toBe(true);
});

it('skips the question when this run installed no skill', async () => {
  fs.rmSync(skillDir('integration-javascript_node'), { recursive: true });
  const { store } = setup();
  await vi.waitFor(() => expect(store.session.skillsComplete).toBe(true));
  expect(fs.existsSync(skillDir('kept-last-time'))).toBe(true);
});
