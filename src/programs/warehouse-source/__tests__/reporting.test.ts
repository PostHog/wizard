/** The standalone `wizard warehouse` command's detection, and the integration flow's scan report. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
  } as never,
}));

import { analytics } from '@utils/analytics';
import { reportWarehouseSourcesDetected } from '@programs/detection/integration';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '@programs/warehouse-sources/detect';
import { buildSession } from '@programs/session/wizard-session';
import { detectWarehousePrerequisites } from '../detect';

describe('reportWarehouseSourcesDetected', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-reporting-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { stripe: '^14.0.0' } }),
    );
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('the standalone warehouse command does not report through this path', () => {
    // `wizard warehouse` writes the same frameworkContext key from its own
    // detect, and sets its own tags. Without a scan-state marker it would also
    // emit this event, which six saved insights read as "the integration flow
    // scanned".
    const session = buildSession({ installDir: tmpDir, ci: true });
    detectWarehousePrerequisites(session, (key, value) => {
      session.frameworkContext[key] = value;
    });
    expect(
      session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY],
    ).toBeDefined();

    reportWarehouseSourcesDetected(session);

    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      'warehouse sources detected',
      expect.anything(),
    );
  });
});
