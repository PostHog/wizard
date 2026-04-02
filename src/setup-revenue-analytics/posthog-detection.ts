/**
 * PostHog distinct_id detection — scans for how the project references distinct_id.
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
];

/**
 * Patterns that capture the distinct_id expression from posthog.identify() calls.
 * Group 1 should be the distinct_id argument.
 */
const IDENTIFY_PATTERNS: Record<Language, RegExp[]> = {
  node: [
    /posthog\.identify\(\s*(['"`]?)([\w.[\]]+)\1/,
    /posthog\.capture\([^,]+,\s*\{[^}]*distinct_?[Ii]d:\s*([^\s,}]+)/,
    /distinctId\s*[:=]\s*([^\s,;]+)/,
  ],
  python: [
    /posthog\.identify\(\s*([^\s,)]+)/,
    /distinct_id\s*=\s*([^\s,)]+)/,
    /posthog\.capture\(\s*([^\s,)]+)/,
  ],
  ruby: [
    /posthog\.identify\(\s*\{\s*distinct_id:\s*([^\s,}]+)/,
    /posthog\.capture\(\s*\{\s*distinct_id:\s*([^\s,}]+)/,
    /distinct_id:\s*([^\s,}]+)/,
  ],
  php: [
    /PostHog::identify\(\s*\[\s*['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,
    /PostHog::capture\(\s*\[\s*['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,
    /['"]distinctId['"]\s*=>\s*([^\s,\]]+)/,
  ],
  go: [
    /DistinctId:\s*([^\s,}]+)/,
    /posthog\.Capture\([^)]*DistinctId:\s*([^\s,}]+)/,
  ],
  java: [/\.distinctId\(\s*([^\s,)]+)/, /setDistinctId\(\s*([^\s,)]+)/],
  dotnet: [
    /DistinctId\s*=\s*([^\s,}]+)/,
    /posthog\.Capture\([^,]*,\s*([^\s,)]+)/,
  ],
};

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
            // Use the last capturing group (the actual expression)
            const expression = match[match.length - 1];
            if (
              expression &&
              !expression.startsWith("'") &&
              !expression.startsWith('"') &&
              !expression.startsWith('`')
            ) {
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
