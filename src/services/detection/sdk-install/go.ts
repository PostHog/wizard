import * as path from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import { dedupeInstalled } from './types';

/** The legacy module and the v2 module can both sit in one `go.mod`; each is its own copy. */
const REQUIRE_LINE =
  /^\s*(?:require\s+)?(github\.com\/posthog\/posthog-go(?:\/v2)?)\s+(v\d+(?:\.\d+)*(?:[-+][\w.-]+)?)(.*)$/gm;

export function readGoInstalls(installDir: string): InstalledSdk[] {
  const content = readProjectFile(path.join(installDir, 'go.mod'));
  if (content === null) return [];
  const copies: InstalledSdk[] = [];
  for (const match of content.matchAll(REQUIRE_LINE)) {
    const [, module, version, rest] = match;
    // An indirect requirement is a dependency's choice, not an import in this project.
    if (/\/\/\s*indirect/.test(rest)) continue;
    const major = Number(/^v(\d+)/.exec(version)?.[1]);
    if (Number.isNaN(major)) continue;
    copies.push({ major, version: `${module} ${version}`, source: 'go.mod' });
  }
  return dedupeInstalled(copies);
}
