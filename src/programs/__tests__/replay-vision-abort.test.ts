import { Integration } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { detectFramework } from '@programs/detection/index';
import { replayVisionConfig } from '@programs/replay-vision/index';
import type { ProgramReadyContext } from '@programs/types';
import { buildProgramSession } from '@programs';

vi.mock('@programs/detection/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@programs/detection/index')>()),
  detectFramework: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), setTag: vi.fn() },
}));
// Programs end a run through their host; the process-level abort is the CLI's.
vi.mock('@utils/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/wizard-abort')>()),
  wizardAbort: () => {
    throw new Error('a program reached for wizardAbort');
  },
}));

it('ends the run through the ready context on a platform replay cannot record', async () => {
  vi.mocked(detectFramework).mockResolvedValue(Integration.go);
  const abort = vi.fn();
  const ctx = {
    session: buildProgramSession({ installDir: '/tmp/go-service' }),
    abort,
  } as unknown as ProgramReadyContext;

  await replayVisionConfig.onReady?.(ctx);

  expect(abort).toHaveBeenCalledWith(
    expect.objectContaining({ code: ErrorCodes.DetectUnsupportedPlatform }),
  );
});
