import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDetectedWarehouseSources } from '@programs/warehouse-sources/detect';
import { SessionStore } from '@programs/session/session-store';
import { buildSession } from '@programs/session/wizard-session';
import { getSelfDrivingDetectedTools } from '../detect';
import { config as selfDriving } from '../index';

describe('the detect step does not leak into the composed integration run', () => {
  // Through the real session store, as a host runs onReady — the leak lived in the plumbing, not in detectConnectedTools.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-driving-detect-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { '@sentry/node': '^7.0.0', pg: '^8.0.0' },
      }),
    );
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('stashes under its own key and leaves the warehouse key untouched', async () => {
    const store = new SessionStore(buildSession({ installDir: tmpDir }));
    await selfDriving.onReady?.(store.readyContext());

    // Self-driving sees its tools...
    expect(
      getSelfDrivingDetectedTools(store.session).map((s) => s.kind),
    ).toContain('Sentry');
    // ...and the integration program, on the session it inherits, sees nothing.
    expect(getDetectedWarehouseSources(store.session)).toEqual([]);
    const inherited = {
      ...store.session,
      frameworkContext: { ...store.session.frameworkContext },
    };
    expect(getDetectedWarehouseSources(inherited)).toEqual([]);
  });
});
