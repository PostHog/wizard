/**
 * What the TUI shows of a detection scan: `scanProgress` over the events
 * detection forwards (`programs/detection/__tests__/agentic-progress.test.ts`).
 */
import type { AgentProgress } from '@agent/types';
import { scanProgress } from '@tui/agent-progress';
import { WizardStore } from '@tui/store';
import { RunPhase } from '@shared/run-state';

vi.mock(import('@utils/debug'));
vi.mock(import('@utils/analytics'));

let store: WizardStore;

beforeEach(() => {
  vi.clearAllMocks();
  store = new WizardStore('posthog-integration');
});

const show = (events: AgentProgress[]) => events.forEach(scanProgress(store));

it('shows only the progress a scan forwards, and leaves the run phase alone', () => {
  show([
    { kind: 'status', message: 'Scanning' },
    { kind: 'log', level: 'warn', message: 'Warn line' },
    { kind: 'activity', line: 'Reading the root manifest.' },
    { kind: 'activity', line: 'Read package.json' },
  ]);
  expect(store.statusMessages).toEqual(['Scanning', 'Warn line']);
  expect(store.session.runPhase).toBe(RunPhase.Idle);
});
