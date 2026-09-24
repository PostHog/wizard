import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, OutroKind } from '@lib/wizard-session';
import { ErrorCodes } from '@shared/errors';
import { Integration } from '@shared/constants';

vi.mock('@utils/analytics', () => ({
  analytics: {
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
    message: 'Could not auto-detect your framework',
  },
  {
    program: 'replay-vision' as const,
    integration: Integration.nextjs,
    dependencies: { next: '^15.0.0' },
    message: "Replay vision couldn't detect a framework",
  },
])(
  '$program framework detection',
  ({ program, integration, dependencies, message }) => {
    let installDir: string;
    let store: WizardStore;
    const exit = new Error('wizard exited');

    beforeEach(() => {
      installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-framework-'));
      store = new WizardStore(program);
      store.session = buildSession({ installDir });
      const ui = new InkUI(store);
      vi.spyOn(ui, 'waitForOutroDismissed').mockResolvedValue(undefined);
      setUI(ui);
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw exit;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('shows the no-framework error before completing detection in an empty project', async () => {
      await expect(store.runReadyHooks()).rejects.toBe(exit);

      expect(store.session.outroData).toEqual(
        expect.objectContaining({
          kind: OutroKind.Error,
          errorCode: ErrorCodes.DetectNoFramework,
          message: expect.stringContaining(message),
        }),
      );
      expect(store.session.detectionComplete).toBe(false);
      expect(store.session.outroData?.message).toContain(
        "app's root directory",
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

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
