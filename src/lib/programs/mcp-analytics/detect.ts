/**
 * MCP analytics language probe.
 *
 * The skill decides for itself whether a project can be instrumented, and when
 * it can't it aborts with `unsupported language for mcp analytics`. That tells
 * us a project was turned away but not *what* it was written in, so there's no
 * way to rank which language to support next. This probe answers that from the
 * manifest files in the install dir and ships the answer as analytics tags, so
 * every event in the run — including the abort — carries it.
 *
 * Manifests only: no source parsing, no recursion. A wrong guess costs a
 * mislabelled tag, so cheap and predictable beats thorough.
 */

import { readdirSync } from 'fs';
import { analytics } from '@utils/analytics';
import { debug } from '@utils/debug';

/** Languages the `@posthog/mcp` / `posthog.mcp` SDKs cover today. */
export const MCP_ANALYTICS_SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
] as const;

/** Manifest filename → language it implies. */
const MANIFEST_LANGUAGES: ReadonlyArray<readonly [string, string]> = [
  ['package.json', 'javascript'],
  ['pyproject.toml', 'python'],
  ['requirements.txt', 'python'],
  ['setup.py', 'python'],
  ['pipfile', 'python'],
  ['go.mod', 'go'],
  ['cargo.toml', 'rust'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['build.gradle.kts', 'kotlin'],
  ['composer.json', 'php'],
  ['gemfile', 'ruby'],
  ['pubspec.yaml', 'dart'],
  ['package.swift', 'swift'],
  ['mix.exs', 'elixir'],
];

/** File extension → language, for ecosystems without a fixed manifest name. */
const EXTENSION_LANGUAGES: ReadonlyArray<readonly [string, string]> = [
  ['.csproj', 'csharp'],
  ['.fsproj', 'fsharp'],
  ['.sln', 'csharp'],
];

/**
 * Map a flat list of directory entry names to the languages they imply,
 * sorted for a stable tag value. Pure — the fs read is the caller's job.
 *
 * `package.json` alone reads as `javascript`; a `tsconfig.json` next to it
 * upgrades that to `typescript`, since the SDK's install path differs.
 */
export function languagesFromEntries(entries: readonly string[]): string[] {
  const lower = entries.map((e) => e.toLowerCase());
  const found = new Set<string>();

  for (const [manifest, language] of MANIFEST_LANGUAGES) {
    if (lower.includes(manifest)) found.add(language);
  }
  for (const [extension, language] of EXTENSION_LANGUAGES) {
    if (lower.some((e) => e.endsWith(extension))) found.add(language);
  }
  if (found.has('javascript') && lower.includes('tsconfig.json')) {
    found.delete('javascript');
    found.add('typescript');
  }

  return [...found].sort();
}

/**
 * Probe `installDir` and tag the run with the languages found. Best effort:
 * an unreadable directory tags nothing rather than failing the run, because
 * the skill — not this probe — decides whether the program can proceed.
 */
export function tagMcpAnalyticsLanguages(installDir: string): void {
  let languages: string[] = [];
  try {
    languages = languagesFromEntries(readdirSync(installDir));
  } catch (error) {
    debug('mcp-analytics language probe failed:', error);
  }

  analytics.setTag('mcp_analytics_languages', languages.join(',') || 'unknown');
  analytics.setTag(
    'mcp_analytics_language_supported',
    languages.some((language) =>
      (MCP_ANALYTICS_SUPPORTED_LANGUAGES as readonly string[]).includes(
        language,
      ),
    ),
  );
}
