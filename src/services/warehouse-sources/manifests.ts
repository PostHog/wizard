/**
 * Dependency-name parsers for the manifests of every ecosystem the wizard
 * installs into. Each returns package names in the form the PostHog tool
 * catalog lists them for that ecosystem. Regex-based on purpose: a manifest is
 * read for names only, so a full parser per language buys nothing, and a
 * malformed file yields fewer names instead of an error.
 */

import { normalizeGitRemote } from '../codebase-scan/fingerprint';

/**
 * Crate names from `Cargo.toml` dependency tables: `[dependencies]`,
 * `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]`,
 * target-specific tables, and the `[dependencies.<name>]` form. Dotted keys
 * (`sentry.workspace = true`) name their crate. A renamed dependency
 * (`alias = { package = "real" }`, `alias.package = "real"`, or a
 * `[dependencies.alias]` table with `package = "real"`) reports the real crate.
 */
export function parseCargoToml(content: string): string[] {
  // Dependency key → the crate it names, in the order keys first appear.
  const crates = new Map<string, string>();
  const add = (key: string, crate?: string): void => {
    if (crate !== undefined) crates.set(key, crate);
    else if (!crates.has(key)) crates.set(key, key);
  };
  let inDeps = false;
  // The dependency a `[dependencies.<name>]` table describes.
  let tableDep: string | null = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    // `[[bin]]` and other array tables end a dependency table too.
    const header = /^\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      const table = header[1].trim();
      const named =
        /(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/.exec(table);
      tableDep = named ? named[1] : null;
      if (tableDep) add(tableDep);
      inDeps = /(?:^|\.)(?:dev-|build-)?dependencies$/.test(table);
      continue;
    }
    if (tableDep) {
      const renamed = /^package\s*=\s*"([^"]+)"/.exec(line);
      if (renamed) add(tableDep, renamed[1]);
      continue;
    }
    if (!inDeps) continue;
    const entry = /^([A-Za-z0-9_-]+)(\.[A-Za-z0-9_-]+)?\s*=(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, subkey, value] = entry;
    let renamed: RegExpExecArray | null = null;
    if (subkey === '.package') renamed = /^\s*"([^"]+)"/.exec(value);
    else if (!subkey) renamed = /\bpackage\s*=\s*"([^"]+)"/.exec(value);
    add(key, renamed?.[1]);
  }
  return [...new Set(crates.values())];
}

/** Pod names from a `Podfile`; a subspec (`Firebase/Analytics`) reports its pod. */
export function parsePodfile(content: string): string[] {
  return [...content.matchAll(/^\s*pod\s+['"]([^'"/]+)/gm)].map((m) => m[1]);
}

/** `composer.json` `require` and `require-dev` keys, minus PHP itself and extensions. */
export function parseComposerJson(content: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    return [];
  }
  if (typeof manifest !== 'object' || manifest === null) return [];
  const names: string[] = [];
  for (const section of ['require', 'require-dev']) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const name of Object.keys(deps)) {
      if (name === 'php' || name.startsWith('ext-')) continue;
      names.push(name.toLowerCase());
    }
  }
  return names;
}

/**
 * Module paths from `go.mod` `require` lines and blocks, without `// indirect`
 * requirements (a dependency of a dependency says little about the project).
 * A final `/vN` major-version element is dropped, so `stripe-go/v82` matches
 * the catalog's `stripe-go`. Case is kept: Go module paths are case-sensitive.
 */
export function parseGoMod(content: string): string[] {
  const names: string[] = [];
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.startsWith(')')) {
        inBlock = false;
        continue;
      }
      addGoRequirement(line, names);
    } else if (/^require\s*\(\s*(?:\/\/.*)?$/.test(line)) {
      inBlock = true;
    } else if (line.startsWith('require ')) {
      addGoRequirement(line.slice('require '.length).trim(), names);
    }
  }
  return names;
}

function addGoRequirement(line: string, names: string[]): void {
  if (!line || line.startsWith('//') || /\/\/\s*indirect\b/.test(line)) return;
  const modulePath = line.split(/\s+/)[0];
  names.push(modulePath.replace(/\/v\d+$/, ''));
}

/** Hex package names from `mix.exs` dependency tuples, e.g. `{:sentry, "~> 10.0"}`. */
export function parseMixExs(content: string): string[] {
  return [...content.matchAll(/\{\s*:([a-z][a-z0-9_]*)\s*,/g)].map((m) => m[1]);
}

const MAVEN_COORDINATE =
  /['"]([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::[^'"\s]*)?['"]/g;
const GRADLE_MAP_NOTATION =
  /group\s*[:=]\s*['"]([^'"]+)['"]\s*,\s*name\s*[:=]\s*['"]([^'"]+)['"]/g;

/** `group:artifact` coordinates from `build.gradle` or `build.gradle.kts`. */
export function parseGradleBuild(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(MAVEN_COORDINATE)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  for (const m of content.matchAll(GRADLE_MAP_NOTATION)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  return names;
}

/** `group:artifact` coordinates from a Gradle version catalog (`libs.versions.toml`). */
export function parseGradleVersionCatalog(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(/\bmodule\s*=\s*"([^":]+):([^":]+)"/g)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  for (const m of content.matchAll(GRADLE_MAP_NOTATION)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  // Plain string form: `sentry = "io.sentry:sentry:7.0.0"`.
  for (const m of content.matchAll(
    /^\s*[A-Za-z0-9_.-]+\s*=\s*"([^":\s]+):([^":\s]+):[^"]*"/gm,
  )) {
    names.push(`${m[1]}:${m[2]}`);
  }
  return names;
}

/**
 * `groupId:artifactId` for each `<dependency>` in a `pom.xml`. Split on the
 * opening tag rather than matched lazily, which would rescan the rest of the
 * file for every unclosed `<dependency>`.
 */
export function parsePomXml(content: string): string[] {
  const names: string[] = [];
  for (const piece of content.split('<dependency>').slice(1)) {
    const close = piece.indexOf('</dependency>');
    if (close === -1) continue;
    const block = piece.slice(0, close);
    const group = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block);
    const artifact = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block);
    if (group && artifact) names.push(`${group[1]}:${artifact[1]}`);
  }
  return names;
}

/** Package names under the top-level `dependencies` and `dev_dependencies` of a `pubspec.yaml`. */
export function parsePubspecYaml(content: string): string[] {
  const names: string[] = [];
  let inDeps = false;
  let entryIndent: number | null = null;
  for (const raw of content.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inDeps = /^(dev_)?dependencies:\s*(?:#.*)?$/.test(raw.trim());
      entryIndent = null;
      continue;
    }
    if (!inDeps) continue;
    entryIndent ??= indent;
    if (indent !== entryIndent) continue;
    const key = /^([A-Za-z0-9_]+)\s*:/.exec(raw.trim());
    if (key) names.push(key[1]);
  }
  return names;
}

/**
 * Package URLs from `Package.swift`, as `host/owner/repo`: lowercased, with no
 * scheme and no `.git`, e.g. `github.com/getsentry/sentry-cocoa`.
 */
export function parsePackageSwift(content: string): string[] {
  return [...content.matchAll(/\burl\s*:\s*"([^"]+)"/g)].map((m) =>
    normalizeGitRemote(m[1]),
  );
}
