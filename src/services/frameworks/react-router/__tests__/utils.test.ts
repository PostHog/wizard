import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getReactRouterMode, ReactRouterMode } from '../utils';

describe('getReactRouterMode', () => {
  let project: string;

  const write = (file: string, body: string) => {
    const target = path.join(project, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  const app = (version: string, files: Record<string, string>) => {
    write(
      'package.json',
      JSON.stringify({ dependencies: { 'react-router': version } }),
    );
    for (const [file, body] of Object.entries(files)) write(file, body);
    return getReactRouterMode({
      installDir: project,
      ci: false,
      debug: false,
      benchmark: false,
      yaraReport: false,
    });
  };

  beforeEach(() => {
    project = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'react-router-mode-')),
    );
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it.each(['^7.11.0', '8.5.2'])(
    'detects framework mode on %s from react-router.config.ts',
    async (version) => {
      await expect(
        app(version, { 'react-router.config.ts': 'export default {}' }),
      ).resolves.toBe(ReactRouterMode.V7_FRAMEWORK);
    },
  );

  it.each(['7.10.1', '^8.0.0'])(
    'detects data mode on %s from createBrowserRouter',
    async (version) => {
      await expect(
        app(version, {
          'src/main.tsx':
            "import { createBrowserRouter } from 'react-router'\nconst router = createBrowserRouter([])",
        }),
      ).resolves.toBe(ReactRouterMode.V7_DATA);
    },
  );

  it('detects declarative mode on React Router 8', async () => {
    await expect(
      app('8.5.2', {
        'src/main.tsx': '<BrowserRouter><App /></BrowserRouter>',
      }),
    ).resolves.toBe(ReactRouterMode.V7_DECLARATIVE);
  });

  it('keeps React Router 6 as v6', async () => {
    await expect(
      app('^6.28.0', { 'react-router.config.ts': 'export default {}' }),
    ).resolves.toBe(ReactRouterMode.V6);
  });
});
