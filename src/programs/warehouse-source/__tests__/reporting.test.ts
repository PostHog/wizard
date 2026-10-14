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

vi.mock(
  import('@programs/warehouse-sources/registry'),
  async (importOriginal) =>
    (
      await import(
        '@programs/warehouse-sources/__tests__/helpers/tool-catalog.no-jest'
      )
    ).withFixtureCatalog(await importOriginal()),
);

import { analytics } from '@utils/analytics';
import { reportWarehouseSourcesDetected } from '@programs/detection/integration';
import {
  DETECTED_WAREHOUSE_SOURCES_KEY,
  getDetectedWarehouseSources,
} from '@programs/warehouse-sources/detect';
import { buildSession } from '@programs/session/wizard-session';
import { SessionStore } from '@programs/session/session-store';
import { reportCodebaseScan, scanCodebaseFor } from '@programs/codebase-scan';
import { detectWarehousePrerequisites } from '../detect';
import { config as warehouse } from '../index';

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

  it('the standalone warehouse command does not report through this path', async () => {
    // `wizard warehouse` writes the same frameworkContext key from its own
    // detect, and sets its own tags. Without a scan-state marker it would also
    // emit this event, which six saved insights read as "the integration flow
    // scanned".
    const session = buildSession({ installDir: tmpDir, ci: true });
    const setFrameworkContext = (key: string, value: unknown) => {
      session.frameworkContext[key] = value;
    };
    await scanCodebaseFor(warehouse, { session, setFrameworkContext });
    await detectWarehousePrerequisites(session, setFrameworkContext);
    expect(
      session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY],
    ).toBeDefined();

    reportWarehouseSourcesDetected(session);

    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      'warehouse sources detected',
      expect.anything(),
    );
  });

  it('offers the sources locally but tags events only once sharing is granted', async () => {
    const store = new SessionStore(buildSession({ installDir: tmpDir }));
    const ctx = store.readyContext();
    await scanCodebaseFor(warehouse, ctx);
    await detectWarehousePrerequisites(ctx.session, ctx.setFrameworkContext);

    expect(
      getDetectedWarehouseSources(store.session).map((s) => s.kind),
    ).toEqual(['Stripe']);
    expect(analytics.setTag).not.toHaveBeenCalled();

    store.grantSharing();
    reportCodebaseScan(store);

    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_kinds',
      'Stripe',
    );
    expect(analytics.setTag).toHaveBeenCalledWith(
      'warehouse_source_modes',
      'Stripe:in-cli',
    );
  });
});
