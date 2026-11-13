import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectOrgAndProject } from '@utils/setup-utils';

vi.mock('@utils/analytics');

describe('signup Git executable trust', () => {
  let tmp: string;
  let project: string;
  let marker: string;

  const git = (directory: string, body: string) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'git'),
      `#!/usr/bin/env node\n${body}\n`,
      { mode: 0o755 },
    );
    if (process.platform === 'win32') {
      fs.writeFileSync(
        path.join(directory, 'git.cmd'),
        '@node "%~dp0\\git" %*\r\n',
      );
    }
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-trust-')));
    project = path.join(tmp, 'my-project');
    marker = path.join(tmp, 'canary');
    fs.mkdirSync(project);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    const bin = path.join(project, 'node_modules', '.bin');
    git(bin, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`);
    vi.stubEnv('PATH', bin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uses the existing fallback when only repository Git is available', () => {
    expect(detectOrgAndProject('developer@example.com')).toEqual({
      orgName: 'example',
      projectName: 'my-project',
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('reads the origin using a trusted installed Git', () => {
    const system = path.join(tmp, 'installed tools');
    git(system, "console.log('git@github.com:acme/product.git');");
    vi.stubEnv('PATH', [process.env.PATH, system].join(path.delimiter));
    expect(detectOrgAndProject('developer@example.com')).toEqual({
      orgName: 'acme',
      projectName: 'product',
    });
    expect(fs.existsSync(marker)).toBe(false);
  });
});
