/** Skill bytes and filesystem placement, independent of agent scan policy. */

import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import { fetchWithRetry, type RetryOpts } from '@shared/posthog/fetch-retry';
import type { SkillEntry } from '@shared/skills/skill-menu';

/** A bundle's files, keyed by variant short id then path. */
export type SkillBundle = {
  id: string;
  variants: Record<string, Record<string, string>>;
};

export type SkillInstallReceipt = {
  skillDir: string;
  fileCount: number;
  /** Undo only files and directories changed by this extraction. */
  rollback: () => void;
};

type PreviousFile = { contents: Buffer; mode: number } | null;

function createWriter(): {
  mkdir: (directory: string) => void;
  write: (file: string, contents: Uint8Array | string) => void;
  rollback: () => void;
} {
  const createdDirs: string[] = [];
  const previousFiles = new Map<string, PreviousFile>();
  let rolledBack = false;

  const mkdir = (directory: string): void => {
    if (fs.existsSync(directory)) return;
    mkdir(path.dirname(directory));
    fs.mkdirSync(directory);
    createdDirs.push(directory);
  };

  const write = (file: string, contents: Uint8Array | string): void => {
    mkdir(path.dirname(file));
    if (!previousFiles.has(file)) {
      previousFiles.set(
        file,
        fs.existsSync(file)
          ? { contents: fs.readFileSync(file), mode: fs.statSync(file).mode }
          : null,
      );
    }
    fs.writeFileSync(file, contents);
  };

  const rollback = (): void => {
    if (rolledBack) return;
    for (const [file, previous] of [...previousFiles].reverse()) {
      if (previous) {
        fs.writeFileSync(file, previous.contents);
        fs.chmodSync(file, previous.mode);
      } else {
        fs.rmSync(file, { force: true });
      }
    }
    for (const directory of [...createdDirs].reverse()) {
      try {
        fs.rmdirSync(directory);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw err;
      }
    }
    rolledBack = true;
  };

  return { mkdir, write, rollback };
}

/** Download a URL to a buffer, retrying transient failures with backoff. */
export async function downloadSkillPayload(
  url: string,
  opts: RetryOpts = {},
): Promise<Uint8Array> {
  const resp = await fetchWithRetry(url, opts);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Extract a zip buffer, refusing entries that escape destDir (zip-slip). */
function extractZipArchive(
  zip: Uint8Array,
  destDir: string,
  writer: ReturnType<typeof createWriter>,
): number {
  const root = path.resolve(destDir);
  let written = 0;
  for (const [entryPath, data] of Object.entries(unzipSync(zip))) {
    const target = path.resolve(root, entryPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`zip entry escapes destination: ${entryPath}`);
    }
    if (entryPath.endsWith('/')) {
      writer.mkdir(target);
      continue;
    }
    writer.write(target, data);
    written++;
  }
  return written;
}

/** Unpack the one variant this entry names out of a bundle; the rest never hits disk. */
function extractBundle(
  bundle: SkillBundle,
  destDir: string,
  entryId: string,
  writer: ReturnType<typeof createWriter>,
): number {
  if (
    typeof bundle?.id !== 'string' ||
    typeof bundle?.variants !== 'object' ||
    bundle.variants === null
  ) {
    throw new Error('malformed bundle: expected { id, variants }');
  }
  const files = bundle.variants[entryId.slice(bundle.id.length + 1)];
  if (!files) {
    throw new Error(`bundle ${bundle.id} has no variant "${entryId}"`);
  }
  const root = path.resolve(destDir);
  let written = 0;
  for (const [entryPath, contents] of Object.entries(files)) {
    const target = path.resolve(root, entryPath);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`bundle entry escapes destination: ${entryPath}`);
    }
    writer.write(target, contents);
    written++;
  }
  return written;
}

/** Extract a downloaded skill and return the exact filesystem changes to undo. */
export function extractSkillPayload(
  skillEntry: SkillEntry,
  installDir: string,
  data: Uint8Array,
  skillsRoot?: string,
): SkillInstallReceipt {
  const skillDir = skillsRoot
    ? path.join(installDir, skillsRoot, skillEntry.id)
    : path.join(installDir, '.claude', 'skills', skillEntry.id);
  const writer = createWriter();
  try {
    writer.mkdir(skillDir);
    const fileCount = skillEntry.bundle
      ? extractBundle(
          JSON.parse(Buffer.from(data).toString('utf8')) as SkillBundle,
          skillDir,
          skillEntry.id,
          writer,
        )
      : extractZipArchive(data, skillDir, writer);
    writer.write(path.join(skillDir, '.posthog-wizard'), '');
    return { skillDir, fileCount, rollback: writer.rollback };
  } catch (err) {
    writer.rollback();
    throw err;
  }
}

export const __test = {
  extractZipArchive: (zip: Uint8Array, destDir: string): number =>
    extractZipArchive(zip, destDir, createWriter()),
  extractBundle: (
    bundle: SkillBundle,
    destDir: string,
    entryId: string,
  ): number => extractBundle(bundle, destDir, entryId, createWriter()),
};
