import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HandoffWatcher,
  MAX_HANDOFF_TEXT_CHARS,
  normalizeHandoffText,
} from '@lib/task-stream/handoff-watcher';
import { SETUP_REPORT_FILE } from '@lib/programs/posthog-integration/index';
import type { WizardStore } from '@ui/tui/store';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createStore() {
  let handoffText: string | null = null;
  return {
    get handoffText() {
      return handoffText;
    },
    setHandoffText(text: string) {
      handoffText = text;
    },
  } as WizardStore;
}

describe('normalizeHandoffText', () => {
  it('rejects non-strings and blank content', () => {
    expect(normalizeHandoffText(undefined)).toBeNull();
    expect(normalizeHandoffText('')).toBeNull();
    expect(normalizeHandoffText('  \n\t ')).toBeNull();
  });

  it('caps at the backend limit so one huge report cannot 400 every later push', () => {
    const oversized = 'x'.repeat(MAX_HANDOFF_TEXT_CHARS + 1000);
    expect(normalizeHandoffText(oversized)).toHaveLength(
      MAX_HANDOFF_TEXT_CHARS,
    );
    expect(normalizeHandoffText('# fine')).toBe('# fine');
  });
});

describe('HandoffWatcher', () => {
  let installDir: string;
  let watcher: HandoffWatcher | undefined;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'wizard-handoff-'));
  });

  afterEach(() => {
    watcher?.stop();
    watcher = undefined;
    rmSync(installDir, { recursive: true, force: true });
  });

  it('mirrors a report written after startup into the store', async () => {
    const store = createStore();
    const path = join(installDir, SETUP_REPORT_FILE);
    watcher = new HandoffWatcher(store, path, { pollIntervalMs: 30 });
    watcher.start();

    writeFileSync(path, '# Setup report\n\nInstalled posthog-js.');
    await wait(120);

    expect(store.handoffText).toBe('# Setup report\n\nInstalled posthog-js.');
  });

  it('keeps following rewrites instead of capturing once', async () => {
    // Follow-up features append to the report after it first appears; a
    // capture-once watcher (the event-plan pattern) would ship the doc
    // without those additions.
    const store = createStore();
    const path = join(installDir, SETUP_REPORT_FILE);
    watcher = new HandoffWatcher(store, path, { pollIntervalMs: 30 });
    watcher.start();

    writeFileSync(path, '# Setup report');
    await wait(120);
    expect(store.handoffText).toBe('# Setup report');

    writeFileSync(path, '# Setup report\n\n## AI observability');
    watcher.refresh();

    expect(store.handoffText).toBe('# Setup report\n\n## AI observability');
  });

  it('ignores a report that predates the current run until it is rewritten', () => {
    const path = join(installDir, SETUP_REPORT_FILE);
    writeFileSync(path, '# Stale report from a previous run');
    const store = createStore();
    watcher = new HandoffWatcher(store, path);

    watcher.start();
    watcher.refresh();

    expect(store.handoffText).toBeNull();
  });
});
