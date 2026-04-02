/**
 * PostHog distinct_id detection — scans for how the project references distinct_id.
 *
 * Patterns sourced from the PostHog docs "Identifying users" page.
 * Each language has SDK-specific patterns for identify(), capture(), alias(),
 * and get_distinct_id() calls. Patterns are ordered by specificity so that
 * the most informative match (e.g. an identify() call) wins over a generic
 * property access.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import type { Language, PostHogDistinctIdResult } from './types';

const FILE_EXTENSIONS: Record<Language, string> = {
  node: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
  python: '**/*.py',
  ruby: '**/*.rb',
  php: '**/*.php',
  go: '**/*.go',
  java: '**/*.{java,kt,kts}',
  dotnet: '**/*.{cs,fs}',
};

const IGNORE_DIRS = [
  '**/node_modules/**',
  '**/venv/**',
  '**/.venv/**',
  '**/env/**',
  '**/.env/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/bin/**',
  '**/obj/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
];

/**
 * Patterns ordered by specificity — identify() calls first (most reliable
 * indicator of what the app uses as distinct_id), then capture() calls
 * (backend SDKs require distinct_id), then alias/assignment patterns.
 *
 * The last capturing group in each regex is the distinct_id expression.
 */
const IDENTIFY_PATTERNS: Record<Language, RegExp[]> = {
  node: [
    // posthog.identify(user.id, ...) — frontend JS/TS SDK
    /posthog\.identify\(\s*(['"`]?)([\w.[\]]+)\1/,

    // client.capture({ distinctId: user.id, ... }) — backend Node SDK
    /\.capture\(\s*\{[^}]*distinctId:\s*([^\s,}]+)/,

    // client.alias({ distinctId: user.id, ... }) — backend Node SDK
    /\.alias\(\s*\{[^}]*distinctId:\s*([^\s,}]+)/,

    // const distinctId = session.user.id — variable assignment
    /(?:const|let|var)\s+distinctId\s*=\s*([^\s,;]+)/,

    // distinctId: user.id — object property (e.g. in capture/alias call)
    /distinctId:\s*([^\s,}]+)/,

    // result = posthog.get_distinct_id() — reveals variable holding the id
    /(\w[\w.]*)\s*=\s*posthog\.get_distinct_id\(\)/,
  ],

  python: [
    // posthog.identify(request.user.pk) — first positional arg
    /posthog\.identify\(\s*([^\s,)]+)/,

    // posthog.capture(distinct_id=user.id, ...) — keyword arg (check before positional)
    /distinct_id\s*=\s*([^\s,)]+)/,

    // posthog.capture(user.id, 'event') — first positional arg
    /posthog\.capture\(\s*([^\s,)]+)/,

    // posthog.alias(previous_id=..., distinct_id=...) — alias call
    /posthog\.alias\([^)]*distinct_id\s*=\s*([^\s,)]+)/,
  ],

  ruby: [
    // posthog.identify({ distinct_id: current_user.id, ... })
    /\.identify\(\s*\{[^}]*distinct_id:\s*([^\s,}]+)/,

    // posthog.capture({ distinct_id: current_user.id, ... })
    /\.capture\(\s*\{[^}]*distinct_id:\s*([^\s,}]+)/,

    // posthog.alias({ distinct_id: value, ... })
    /\.alias\(\s*\{[^}]*distinct_id:\s*([^\s,}]+)/,

    // distinct_id: current_user.id — hash key in any context
    /distinct_id:\s*([^\s,}]+)/,
  ],

  php: [
    // PostHog::identify(['distinctId' => $user->id, ...])
    /PostHog::identify\(\s*\[[^\]]*['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,

    // PostHog::capture(['distinctId' => $user->id, ...])
    /PostHog::capture\(\s*\[[^\]]*['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,

    // PostHog::alias(['distinctId' => $user->id, ...])
    /PostHog::alias\(\s*\[[^\]]*['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,

    // 'distinctId' => $user->id — array key in any context
    /['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,
  ],

  go: [
    // posthog.Identify{ DistinctId: user.ID, ... }
    /posthog\.Identify\{[^}]*DistinctId:\s*([^\s,}]+)/,

    // posthog.Capture{ DistinctId: user.ID, ... }
    /posthog\.Capture\{[^}]*DistinctId:\s*([^\s,}]+)/,

    // posthog.Alias{ DistinctId: user.ID, ... }
    /posthog\.Alias\{[^}]*DistinctId:\s*([^\s,}]+)/,

    // DistinctId: user.ID — struct field in any context
    /DistinctId:\s*([^\s,}]+)/,
  ],

  java: [
    // posthog.identify(user.getId(), ...) — first positional arg
    /posthog\.identify\(\s*([\w.]+(?:\(\))?)/,

    // posthog.capture(user.getId(), ...) — first positional arg
    /posthog\.capture\(\s*([\w.]+(?:\(\))?)/,

    // posthog.alias(frontendId, backendId) — first arg is distinct_id
    /posthog\.alias\(\s*([\w.]+(?:\(\))?)/,

    // PostHog.identify(distinctId = value, ...) — Kotlin named param (Android SDK)
    /PostHog\.identify\(\s*distinctId\s*=\s*([\w.]+(?:\(\))?)/,

    // .distinctId(user.getId()) — builder pattern
    /\.distinctId\(\s*([\w.]+(?:\(\))?)/,

    // setDistinctId(user.getId())
    /setDistinctId\(\s*([\w.]+(?:\(\))?)/,
  ],

  dotnet: [
    // posthog.Identify(userId, ...) or posthog.IdentifyAsync(userId, ...)
    /\.Identify(?:Async)?\(\s*([^\s,)]+)/,

    // posthog.Capture(userId, ...) or posthog.CaptureAsync(userId, ...)
    /\.Capture(?:Async)?\(\s*([^\s,)]+)/,

    // DistinctId = user.Id — property assignment in options object
    /DistinctId\s*=\s*([^\s,}]+)/,
  ],
};

/**
 * Values that are clearly placeholder/example strings, not real expressions.
 * These come from PostHog docs examples and should be skipped.
 */
const PLACEHOLDER_VALUES = new Set([
  'distinct_id',
  'distinctId',
  'distinctid',
  'distinct_id_one',
  'distinct_id_two',
  'user_A',
  'user1',
  'user2',
  'frontend_id',
  'backend_id',
]);

function isValidExpression(expression: string): boolean {
  if (!expression) return false;

  // Skip string literals
  if (
    expression.startsWith("'") ||
    expression.startsWith('"') ||
    expression.startsWith('`')
  ) {
    return false;
  }

  // Skip placeholder values commonly seen in docs/examples
  if (PLACEHOLDER_VALUES.has(expression)) return false;

  // Skip purely numeric values
  if (/^\d+$/.test(expression)) return false;

  // Must look like a variable/property access (contains at least one letter)
  return /[a-zA-Z]/.test(expression);
}

export async function detectPostHogDistinctId(
  installDir: string,
  language: Language,
): Promise<PostHogDistinctIdResult> {
  const files = await fg(FILE_EXTENSIONS[language], {
    cwd: installDir,
    ignore: IGNORE_DIRS,
  });

  const patterns = IDENTIFY_PATTERNS[language];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(installDir, file), 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
          const match = pattern.exec(line);
          if (match) {
            const expression = match[match.length - 1];
            if (isValidExpression(expression)) {
              return {
                distinctIdExpression: expression,
                sourceFile: file,
                sourceLine: line.trim(),
              };
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  return {
    distinctIdExpression: null,
    sourceFile: null,
    sourceLine: null,
  };
}
