import { createElement } from 'react';
import { render, cleanup } from 'ink-testing-library';
import * as detection from '@lib/detection/index';
import { PostHogIntegrationIntroScreen } from '@ui/tui/screens/PostHogIntegrationIntroScreen';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WizardStore, ScreenId } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, OutroKind } from '@lib/wizard-session';
import { ErrorCodes } from '@shared/errors';
import { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { getProgramConfig } from '@lib/programs/program-registry';

vi.mock('ink', () =>
  vi.importActual('../../../../node_modules/ink/build/index.js'),
);

vi.mock('@lib/detection/project-scope', () => ({
  scopeInstallDirToProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@utils/analytics', () => ({
  analytics: {
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    captureException: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

describe.each([
  {
    program: 'posthog-integration' as const,
    integration: Integration.javascriptNode,
    dependencies: {},
    message: 'Could not detect a framework',
    modes: ['ci', 'run'] as const,
  },
  {
    program: 'replay-vision' as const,
    integration: Integration.nextjs,
    dependencies: { next: '^15.0.0' },
    message: "Replay vision couldn't detect a framework",
    modes: ['interactive', 'ci'] as const,
  },
])(
  '$program framework detection',
  ({ program, integration, dependencies, message, modes }) => {
    let installDir: string;
    let store: WizardStore;
    const exit = new Error('wizard exited');

    beforeEach(() => {
      vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
      installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-framework-'));
      store = new WizardStore(program);
      store.session = buildSession({ installDir });
      const ui = new InkUI(store);
      setUI(ui);
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw exit;
      });
    });

    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
      fs.rmSync(installDir, { recursive: true, force: true });
    });

    it.each(modes)(
      'shows the no-framework error for an empty project in %s mode',
      async (mode) => {
        store.session = buildSession({ installDir, ci: mode === 'ci' });
        const config = getProgramConfig(program);
        const detection =
          mode === 'run' && typeof config.run === 'function'
            ? config.run(store.session)
            : mode === 'ci'
            ? config.ciPreRun?.(store.session)
            : store.runReadyHooks();
        if (!detection) throw new Error('expected a detection hook');
        const finished = expect(detection).rejects.toBe(exit);
        try {
          await vi.waitFor(() =>
            expect(store.session.outroData).not.toBeNull(),
          );

          expect(store.session.outroData).toEqual(
            expect.objectContaining({
              kind: OutroKind.Error,
              errorCode: ErrorCodes.DetectNoFramework,
              message: expect.stringContaining(message),
            }),
          );
          expect(store.session.detectionComplete).toBe(false);
          expect(store.router.resolve(store.session)).toBe(ScreenId.Outro);
          expect(store.session.outroData?.instruction).toContain(
            'an app root directory',
          );
          expect(process.exit).not.toHaveBeenCalled();
        } finally {
          store.setOutroDismissed();
          await finished;
        }
        expect(process.exit).toHaveBeenCalledWith(1);
      },
    );

    if (program === 'posthog-integration') {
      it('lets users pick a supported framework after auto-detection misses their project', async () => {
        fs.writeFileSync(
          path.join(installDir, 'package.json'),
          JSON.stringify({ dependencies: { next: '^15.0.0' } }),
        );
        vi.spyOn(detection, 'detectFramework').mockResolvedValueOnce(undefined);

        await store.runReadyHooks();

        expect(store.session.detectionComplete).toBe(true);
        expect(store.session.frameworkConfig).toBeNull();
        expect(store.session.outroData).toBeNull();
        expect(store.router.resolve(store.session)).toBe(ScreenId.Intro);
        const screen = render(
          createElement(PostHogIntegrationIntroScreen, { store }),
        );
        await vi.waitFor(() =>
          expect(screen.lastFrame()).toContain('Select your framework'),
        );

        screen.stdin.write('\r');

        await vi.waitFor(() =>
          expect(store.session.integration).toBe(Integration.nextjs),
        );
        await vi.waitFor(() =>
          expect(screen.lastFrame()).toContain('Continue'),
        );
        const config = getProgramConfig(program);
        if (typeof config.run !== 'function')
          throw new Error('expected run hook');
        const run = await config.run(store.session);
        expect(run.integrationLabel).toBe(Integration.nextjs);
        expect(store.session.outroData).toBeNull();
        expect(process.exit).not.toHaveBeenCalled();
      });
    }

    it('completes detection and selects the skill for a recognized project', async () => {
      fs.writeFileSync(
        path.join(installDir, 'package.json'),
        JSON.stringify({ dependencies }),
      );

      await store.runReadyHooks();

      expect(store.session.integration).toBe(integration);
      expect(store.session.skillId).toBe(integration);
      expect(store.session.detectionComplete).toBe(true);
      expect(process.exit).not.toHaveBeenCalled();
    });
  },
);
