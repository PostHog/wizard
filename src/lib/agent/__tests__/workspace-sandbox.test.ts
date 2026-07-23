import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findWorkspaceRoot,
  workspaceRootWritePaths,
} from '@lib/agent/workspace-sandbox';

describe('workspace-sandbox', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-ws-'));
    // fs.realpath resolves /var -> /private/var symlinks on macOS so the
    // expected paths line up with what findWorkspaceRoot returns.
    root = fs.realpathSync(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, contents = ''): void {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  describe('findWorkspaceRoot', () => {
    it('returns null when the install dir is not nested in a monorepo', () => {
      write('package.json', JSON.stringify({ name: 'solo' }));
      expect(findWorkspaceRoot(root)).toBeNull();
    });

    it('detects a pnpm workspace root above a sub-package', () => {
      write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
      write('packages/app/package.json', JSON.stringify({ name: 'app' }));
      expect(findWorkspaceRoot(path.join(root, 'packages/app'))).toBe(root);
    });

    it('detects a yarn/npm workspaces array root', () => {
      write(
        'package.json',
        JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      );
      write('packages/app/package.json', JSON.stringify({ name: 'app' }));
      expect(findWorkspaceRoot(path.join(root, 'packages/app'))).toBe(root);
    });

    it('detects a workspaces.packages object root', () => {
      write(
        'package.json',
        JSON.stringify({
          name: 'mono',
          workspaces: { packages: ['apps/*'] },
        }),
      );
      write('apps/web/package.json', JSON.stringify({ name: 'web' }));
      expect(findWorkspaceRoot(path.join(root, 'apps/web'))).toBe(root);
    });

    it('does not treat the install dir itself as the workspace root', () => {
      write(
        'package.json',
        JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      );
      // Launched at the root itself — its own subtree is already writable.
      expect(findWorkspaceRoot(root)).toBeNull();
    });

    it('returns the nearest declaring ancestor for deeply nested packages', () => {
      write(
        'package.json',
        JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      );
      write('packages/group/app/package.json', JSON.stringify({ name: 'app' }));
      expect(findWorkspaceRoot(path.join(root, 'packages/group/app'))).toBe(
        root,
      );
    });

    it('ignores a package.json with an empty workspaces array', () => {
      write('package.json', JSON.stringify({ name: 'mono', workspaces: [] }));
      write('packages/app/package.json', JSON.stringify({ name: 'app' }));
      expect(findWorkspaceRoot(path.join(root, 'packages/app'))).toBeNull();
    });

    it('ignores a malformed root package.json', () => {
      write('package.json', '{ not valid json');
      write('packages/app/package.json', JSON.stringify({ name: 'app' }));
      expect(findWorkspaceRoot(path.join(root, 'packages/app'))).toBeNull();
    });
  });

  describe('workspaceRootWritePaths', () => {
    it('returns [] when not in a monorepo', () => {
      write('package.json', JSON.stringify({ name: 'solo' }));
      expect(workspaceRootWritePaths(root)).toEqual([]);
    });

    it('whitelists the workspace root node_modules and lockfiles', () => {
      write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
      write('packages/app/package.json', JSON.stringify({ name: 'app' }));

      const paths = workspaceRootWritePaths(path.join(root, 'packages/app'));

      // SDK sandbox convention: a leading slash prepended to the absolute path.
      expect(paths).toContain(`/${root}/node_modules`);
      expect(paths).toContain(`/${root}/node_modules/**`);
      expect(paths).toContain(`/${root}/pnpm-lock.yaml`);
      expect(paths).toContain(`/${root}/yarn.lock`);
      expect(paths).toContain(`/${root}/package-lock.json`);
      expect(paths).toContain(`/${root}/bun.lock`);
    });
  });
});
