import * as path from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import { boundedGlob } from '@utils/bounded-fs';
import { dedupeInstalled, LOCKFILE_MAX_BYTES } from './types';
import {
  isUnboundedRequirement,
  lowerBoundMajor,
  majorOfVersion,
} from './version-spec';

const PYPI_PACKAGE = 'posthog';

/** uv, poetry and pdm locks all write `[[package]]` tables with `name` and `version` keys. */
function readTomlLock(content: string, source: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  for (const block of content.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name?.toLowerCase() !== PYPI_PACKAGE) continue;
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const major = version === undefined ? undefined : majorOfVersion(version);
    if (version !== undefined && major !== undefined) {
      copies.push({ major, version, source });
    }
  }
  return copies;
}

function readPipfileLock(content: string): InstalledSdk[] {
  const lock = JSON.parse(content) as Record<
    string,
    Record<string, { version?: string }> | undefined
  >;
  const copies: InstalledSdk[] = [];
  for (const section of ['default', 'develop']) {
    const spec = lock[section]?.[PYPI_PACKAGE]?.version;
    const major = spec === undefined ? undefined : lowerBoundMajor(spec);
    if (spec !== undefined && major !== undefined) {
      copies.push({ major, version: spec, source: 'Pipfile.lock' });
    }
  }
  return copies;
}

/** A PEP 508 requirement for the package: `posthog`, `posthog[flags]>=7,<8`, `posthog >= 7`. */
const REQUIREMENT = new RegExp(
  `^\\s*${PYPI_PACKAGE}\\s*(?:\\[[^\\]]*\\])?\\s*([^;#\\s][^;#]*)?`,
  'i',
);

function requirementMajor(
  line: string,
): { spec: string; major: number } | undefined {
  const match = REQUIREMENT.exec(line);
  if (!match) return undefined;
  const spec = (match[1] ?? '').trim();
  const major = lowerBoundMajor(spec);
  return major === undefined
    ? undefined
    : { spec: spec || PYPI_PACKAGE, major };
}

function readRequirements(content: string, source: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  for (const line of content.split('\n')) {
    const found = requirementMajor(line);
    if (found) copies.push(manifestCopy(found.major, found.spec, source));
  }
  return copies;
}

/**
 * PEP 621 `dependencies = ["posthog>=7,<8"]`, and the poetry and pdm tables:
 * `posthog = "^3.0"` or `posthog = { version = ">=7" }`.
 */
function manifestCopy(
  major: number,
  spec: string,
  source: string,
): InstalledSdk {
  return {
    major,
    version: spec,
    source,
    ...(isUnboundedRequirement(spec) ? { unbounded: true } : {}),
  };
}

/** The TOML tables whose arrays and keys declare dependencies. */
const DEPENDENCY_TABLES = new Set([
  'project',
  'project.optional-dependencies',
  'dependency-groups',
  'tool.poetry.dependencies',
  'tool.poetry.dev-dependencies',
  'tool.poetry.group',
  'tool.pdm.dev-dependencies',
  'tool.uv',
]);

function isDependencyTable(table: string): boolean {
  if (DEPENDENCY_TABLES.has(table)) return true;
  return (
    table.startsWith('tool.poetry.group.') ||
    table.startsWith('tool.pdm.') ||
    table.startsWith('tool.uv.')
  );
}

/**
 * PEP 621 `dependencies = ["posthog>=7,<8"]` and the optional-dependency and
 * dependency-group arrays, plus the poetry and pdm tables: `posthog = "^3.0"`
 * or `posthog = { version = ">=7" }`. Only dependency tables are read, so a
 * description or URL that mentions posthog is not a copy.
 */
function readPyproject(content: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  const quoted = new RegExp(
    `["']\\s*(${PYPI_PACKAGE}\\s*(?:\\[[^\\]]*\\])?\\s*[^"']*)["']`,
    'gi',
  );
  const table = new RegExp(
    `^\\s*${PYPI_PACKAGE}\\s*=\\s*(?:"([^"]+)"|\\{[^}]*version\\s*=\\s*"([^"]+)")`,
    'gim',
  );
  let current = '';
  let section: string[] = [];
  const flush = () => {
    if (!isDependencyTable(current)) return;
    const text = section.join('\n');
    const arrays =
      current === 'project'
        ? [
            ...text.matchAll(
              /^\s*dependencies\s*=\s*\[([\s\S]*?)\](?=[ \t]*(?:#.*)?$)/gm,
            ),
          ].map((m) => m[1])
        : [
            ...text.matchAll(
              /^\s*[\w.-]+\s*=\s*\[([\s\S]*?)\](?=[ \t]*(?:#.*)?$)/gm,
            ),
          ].map((m) => m[1]);
    for (const array of arrays) {
      for (const match of array.matchAll(quoted)) {
        const found = requirementMajor(match[1]);
        if (found) {
          copies.push(manifestCopy(found.major, found.spec, 'pyproject.toml'));
        }
      }
    }
    for (const match of text.matchAll(table)) {
      const spec = match[1] ?? match[2];
      const major = lowerBoundMajor(spec);
      if (major !== undefined) {
        copies.push(manifestCopy(major, spec, 'pyproject.toml'));
      }
    }
  };
  for (const line of content.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      flush();
      current = header[1].trim();
      section = [];
      continue;
    }
    section.push(line);
  }
  flush();
  return copies;
}

function readPipfile(content: string): InstalledSdk[] {
  const match = new RegExp(`^\\s*${PYPI_PACKAGE}\\s*=\\s*"([^"]+)"`, 'im').exec(
    content,
  );
  const major = match ? lowerBoundMajor(match[1]) : undefined;
  return match && major !== undefined
    ? [manifestCopy(major, match[1], 'Pipfile')]
    : [];
}

const LOCKFILES: ReadonlyArray<[string, (content: string) => InstalledSdk[]]> =
  [
    ['uv.lock', (c) => readTomlLock(c, 'uv.lock')],
    ['poetry.lock', (c) => readTomlLock(c, 'poetry.lock')],
    ['pdm.lock', (c) => readTomlLock(c, 'pdm.lock')],
    ['Pipfile.lock', readPipfileLock],
  ];

export async function readPypiInstalls(
  installDir: string,
): Promise<InstalledSdk[]> {
  for (const [file, parse] of LOCKFILES) {
    const content = readProjectFile(
      path.join(installDir, file),
      LOCKFILE_MAX_BYTES,
    );
    if (content === null) continue;
    try {
      const copies = dedupeInstalled(parse(content));
      if (copies.length > 0) return copies;
    } catch {
      // A malformed lockfile falls through to the manifests.
    }
  }
  const copies: InstalledSdk[] = [];
  const pyproject = readProjectFile(path.join(installDir, 'pyproject.toml'));
  if (pyproject !== null) copies.push(...readPyproject(pyproject));
  const pipfile = readProjectFile(path.join(installDir, 'Pipfile'));
  if (pipfile !== null) copies.push(...readPipfile(pipfile));
  const requirementFiles = await boundedGlob('requirements*.txt', {
    cwd: installDir,
    deep: 1,
    limit: 20,
  });
  for (const file of requirementFiles.sort()) {
    const content = readProjectFile(path.join(installDir, file));
    if (content !== null) copies.push(...readRequirements(content, file));
  }
  return dedupeInstalled(copies);
}
