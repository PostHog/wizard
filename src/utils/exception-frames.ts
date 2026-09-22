/**
 * Give the wizard's own stack frames an identity that does not change per user.
 *
 * posthog-node makes every frame path relative to `process.cwd()`. The wizard
 * runs from the user's project while its bundle sits in an npx / dlx / bunx
 * cache, so one frame arrives under a different path for nearly every run —
 * different `../` depth, cache hash, home directory, drive letter — and error
 * tracking files the same failure as a new issue per path. Frames inside a
 * package cache are never marked `in_app` either, though this bundle is the
 * application. Both are fixed by re-anchoring our frames to the package root.
 */

import { isAbsolute, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

/** Root of the installed package — this module is bundled into `<root>/dist`. */
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Content hash rolldown appends to a split chunk, e.g. `-CksP2v2P`. */
const BUILD_HASH = /-[A-Za-z0-9_-]{8}(\.[cm]?js)$/;

type Frame = { source?: string; in_app?: boolean };

/** `<root>/dist/agent-runner-CksP2v2P.js` → `dist/agent-runner.js`, else null. */
function packageRelativeSource(source: string): string | null {
  const path = relative(PACKAGE_ROOT, resolve(process.cwd(), source));
  if (!path || path.startsWith('..') || isAbsolute(path)) return null;
  return path.split(sep).join('/').replace(BUILD_HASH, '$1');
}

/** Rewrite the wizard's own frames in place; every other frame is left alone. */
export function stabilizeOwnFrames(exceptionList: unknown): void {
  if (!Array.isArray(exceptionList)) return;
  for (const exception of exceptionList) {
    const frames = (exception as { stacktrace?: { frames?: Frame[] } })
      ?.stacktrace?.frames;
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (!frame?.source) continue;
      const source = packageRelativeSource(frame.source);
      if (source === null) continue;
      frame.source = source;
      frame.in_app = true;
    }
  }
}
