import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';

vi.mock('ink', () => vi.importActual<typeof import('ink')>('ink-actual'));
vi.mock(import('@programs'), async (original) => ({
  ...(await original()),
  buildProjectSelection: vi.fn(),
  pickLeavesRunProject: vi.fn(),
}));

import {
  buildProjectSelection,
  buildSession,
  pickLeavesRunProject,
} from '@programs';
import { config as posthogIntegration } from '@programs/posthog-integration';
import type { ProjectSelection } from '@programs/types';
import { WizardStore } from '@tui/store';
import { PostHogIntegrationIntroScreen } from '../PostHogIntegrationIntroScreen';

const PLAN: ProjectSelection = {
  repoType: 'monorepo',
  selectedProjectPath: '.',
  isDiscoveryComplete: true,
  projects: [
    {
      path: '.',
      eligible: false,
      exclusionReason: 'workspace-root',
      isMainApp: false,
    },
    { path: 'apps/web', eligible: true, isMainApp: false },
    { path: 'apps/admin', eligible: true, isMainApp: false },
  ],
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

/** The intro once detection found no framework in the launch directory. */
async function frameworklessIntro(leaves: boolean): Promise<string> {
  vi.mocked(buildProjectSelection).mockReturnValue(PLAN);
  vi.mocked(pickLeavesRunProject).mockReturnValue(leaves);
  const store = new WizardStore(posthogIntegration.id);
  store.launch(buildSession({ installDir: '/tmp/workspace' }));
  store.setDetectionComplete();
  const screen = render(<PostHogIntegrationIntroScreen store={store} />);
  await tick();
  return screen.lastFrame() ?? '';
}

afterEach(() => cleanup());

describe('the intro in a directory with no framework', () => {
  it('asks for no framework when the run picks its project after login', async () => {
    const frame = await frameworklessIntro(true);

    expect(frame).not.toContain('Select your framework');
    expect(frame).not.toContain('Change framework');
    expect(frame).toContain('Continue');
    expect(frame).toMatch(/Projects\s+✔ 2 found/);
  });

  it('asks for the framework when the run stays in that directory', async () => {
    const frame = await frameworklessIntro(false);

    expect(frame).toContain('Select your framework');
    expect(frame).not.toContain('Continue');
  });
});
