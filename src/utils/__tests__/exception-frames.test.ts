import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { stabilizeOwnFrames } from '@utils/exception-frames';

// The module computes its package root as its own directory's parent, so under
// vitest (unbundled) that is `src/`, two levels up from this test file.
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

const listWith = (...sources: string[]) => [
  { stacktrace: { frames: sources.map((source) => ({ source })) } },
];

describe('stabilizeOwnFrames', () => {
  it('rewrites the wizard’s own frames to a package-relative path without the build hash', () => {
    const list = listWith(`${PACKAGE_ROOT}/dist/agent-runner-CksP2v2P.js`);

    stabilizeOwnFrames(list);

    expect(list[0].stacktrace.frames[0]).toEqual({
      source: 'dist/agent-runner.js',
      in_app: true,
    });
  });

  it('gives one frame the same source whatever directory the wizard runs from', () => {
    const absolute = `${PACKAGE_ROOT}/dist/bin.js`;
    const results = ['/home/someone/a-project', '/tmp'].map((cwd) => {
      const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
      const list = listWith(absolute);
      stabilizeOwnFrames(list);
      spy.mockRestore();
      return list[0].stacktrace.frames[0].source;
    });

    expect(results).toEqual(['dist/bin.js', 'dist/bin.js']);
  });

  it('leaves frames outside the package alone', () => {
    const sources = [
      '../../.npm/_npx/e5076a3e/node_modules/ink/build/components/App.js',
      'node:internal/modules/esm/loader',
    ];
    const list = listWith(...sources);

    stabilizeOwnFrames(list);

    expect(list[0].stacktrace.frames).toEqual(
      sources.map((s) => ({ source: s })),
    );
  });

  it('ignores exceptions that carry no frames', () => {
    expect(() => stabilizeOwnFrames([{ type: 'Error' }, null])).not.toThrow();
    expect(() => stabilizeOwnFrames(undefined)).not.toThrow();
  });
});
