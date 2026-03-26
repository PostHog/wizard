/**
 * Pre-computed codebase audit scanner.
 *
 * Scans source files for competitor SDK references (imports, initialization,
 * API calls, config) without any LLM involvement. Produces a structured
 * manifest that migration agents can use as a starting point instead of
 * grepping the entire codebase themselves.
 */

import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';
import { AdditionalFeature } from './wizard-session';

export interface AuditHit {
  /** Relative path from installDir */
  file: string;
  /** 1-based line number */
  line: number;
  /** The matched line, trimmed */
  content: string;
  /** Classification of the match */
  type: 'import' | 'initialization' | 'api_call' | 'config' | 'reference';
}

export type CompetitorKey =
  | 'amplitude'
  | 'sentry'
  | 'launchdarkly'
  | 'braintrust';

export type CodebaseAuditManifest = Partial<Record<CompetitorKey, AuditHit[]>>;

/** Maps AdditionalFeature migration types to their competitor keys. */
const FEATURE_TO_COMPETITOR: Partial<Record<AdditionalFeature, CompetitorKey>> =
  {
    [AdditionalFeature.AmplitudeMigration]: 'amplitude',
    [AdditionalFeature.SentryMigration]: 'sentry',
    [AdditionalFeature.LaunchDarklyMigration]: 'launchdarkly',
    [AdditionalFeature.BraintrustMigration]: 'braintrust',
  };

interface ScanPattern {
  /** Regex to match against each line */
  pattern: RegExp;
  /** Classification for matched lines */
  type: AuditHit['type'];
}

const COMPETITOR_PATTERNS: Record<CompetitorKey, ScanPattern[]> = {
  amplitude: [
    {
      pattern: /(?:import\s.*from\s+['"]|require\s*\(\s*['"])@?amplitude[/'"-]/,
      type: 'import',
    },
    {
      pattern: /amplitude\s*\.\s*init\s*\(/i,
      type: 'initialization',
    },
    {
      pattern:
        /(?:amplitude\s*\.\s*(?:track|identify|setUserId|logEvent|setGroup|groupIdentify|revenue|flush)\s*\()/i,
      type: 'api_call',
    },
    {
      pattern: /(?:ampli\s*\.\s*(?:track|identify|load|flush)\s*\()/i,
      type: 'api_call',
    },
    {
      pattern:
        /(?:import\s.*from\s+['"]|require\s*\(\s*['"])(?:amplitude-js|ampli)['"]/,
      type: 'import',
    },
  ],
  sentry: [
    {
      pattern: /(?:import\s.*from\s+['"]|require\s*\(\s*['"])@sentry\//,
      type: 'import',
    },
    {
      pattern: /Sentry\s*\.\s*init\s*\(/,
      type: 'initialization',
    },
    {
      pattern:
        /Sentry\s*\.\s*(?:captureException|captureMessage|captureEvent|withScope|setUser|setTag|setContext|addBreadcrumb|startSpan)\s*\(/,
      type: 'api_call',
    },
    {
      pattern:
        /(?:import\s.*from\s+['"]|require\s*\(\s*['"])(?:sentry-sdk|sentry-ruby|sentry-rails)['"]/,
      type: 'import',
    },
    {
      pattern: /(?:SentryErrorBoundary|ErrorBoundary.*sentry)/i,
      type: 'reference',
    },
  ],
  launchdarkly: [
    {
      pattern:
        /(?:import\s.*from\s+['"]|require\s*\(\s*['"])(?:@launchdarkly\/|launchdarkly-)/,
      type: 'import',
    },
    {
      pattern: /(?:LDClient|launchdarkly)\s*\.\s*init\s*\(/i,
      type: 'initialization',
    },
    {
      pattern:
        /(?:\.variation\s*\(|\.allFlags\s*\(|useFlags\s*\(|useLDClient\s*\()/,
      type: 'api_call',
    },
    {
      pattern:
        /(?:LDProvider|withLDProvider|asyncWithLDProvider|LDContext|LDUser)/,
      type: 'reference',
    },
  ],
  braintrust: [
    {
      pattern:
        /(?:import\s.*from\s+['"]|require\s*\(\s*['"])(?:braintrust|@braintrust\/|autoevals)['"/]/,
      type: 'import',
    },
    {
      pattern: /(?:Braintrust|braintrust)\s*\.\s*init\s*\(/,
      type: 'initialization',
    },
    {
      pattern:
        /(?:\.traced\s*\(|\.log\s*\(|initLogger\s*\(|wrapOpenAI\s*\(|wrapAnthropic\s*\()/,
      type: 'api_call',
    },
    {
      pattern: /(?:@traced|@braintrust)/,
      type: 'reference',
    },
  ],
};

const SOURCE_PATTERNS = [
  '**/*.{ts,tsx,js,jsx,mjs,cjs}',
  '**/*.py',
  '**/*.rb',
  '**/*.go',
  '**/*.java',
  '**/*.kt',
  '**/*.swift',
];

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/Pods/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/*.map',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
];

/**
 * Determine which competitors to scan for based on selected migration features.
 */
export function getCompetitorsFromFeatures(
  features: readonly AdditionalFeature[],
): CompetitorKey[] {
  const competitors: CompetitorKey[] = [];
  for (const feature of features) {
    const competitor = FEATURE_TO_COMPETITOR[feature];
    if (competitor) {
      competitors.push(competitor);
    }
  }
  return competitors;
}

/**
 * Scan the codebase for competitor SDK references.
 *
 * Returns a manifest mapping each competitor to its audit hits.
 * Only scans for competitors that correspond to selected migration features.
 */
export async function scanCodebaseForCompetitors(
  installDir: string,
  competitors: CompetitorKey[],
): Promise<CodebaseAuditManifest> {
  if (competitors.length === 0) return {};

  const filePaths = await fg(SOURCE_PATTERNS, {
    cwd: installDir,
    absolute: false,
    onlyFiles: true,
    unique: true,
    ignore: IGNORE_PATTERNS,
  });

  const manifest: CodebaseAuditManifest = {};

  // Build a combined patterns list for efficient single-pass scanning
  const activePatterns = competitors.flatMap((competitor) =>
    (COMPETITOR_PATTERNS[competitor] ?? []).map((p) => ({
      ...p,
      competitor,
    })),
  );

  for (const relativePath of filePaths) {
    const absolutePath = path.join(installDir, relativePath);

    let content: string;
    try {
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern, type, competitor } of activePatterns) {
        if (pattern.test(line)) {
          if (!manifest[competitor]) {
            manifest[competitor] = [];
          }
          manifest[competitor].push({
            file: relativePath,
            line: i + 1,
            content: line.trim(),
            type,
          });
          // One hit per line to avoid duplicates
          break;
        }
      }
    }
  }

  return manifest;
}

/**
 * Format an audit manifest slice for a single competitor into a human-readable
 * string suitable for injection into a migration agent's prompt.
 */
export function formatAuditForPrompt(
  manifest: CodebaseAuditManifest,
  competitor: CompetitorKey,
): string {
  const hits = manifest[competitor];
  if (!hits || hits.length === 0) {
    return `Pre-computed codebase audit for ${competitor}: No references found in source files. The SDK may only be referenced in package manifests or lock files.`;
  }

  // Group by file
  const byFile = new Map<string, AuditHit[]>();
  for (const hit of hits) {
    const existing = byFile.get(hit.file);
    if (existing) {
      existing.push(hit);
    } else {
      byFile.set(hit.file, [hit]);
    }
  }

  const fileCount = byFile.size;
  const lines: string[] = [
    `Pre-computed codebase audit for ${competitor}:`,
    `Found ${hits.length} reference${
      hits.length === 1 ? '' : 's'
    } across ${fileCount} file${fileCount === 1 ? '' : 's'}:`,
    '',
  ];

  for (const [file, fileHits] of byFile) {
    lines.push(`${file}:`);
    for (const hit of fileHits) {
      lines.push(`  Line ${hit.line}: ${hit.content} [${hit.type}]`);
    }
    lines.push('');
  }

  lines.push(
    'Use this audit as your starting point instead of grepping for references.',
    'Verify each reference is still present before modifying it (files may have changed during the base setup phase).',
  );

  return lines.join('\n');
}

/**
 * Generate a lightweight project context summary for migration agents.
 *
 * Includes the top-level file tree, key config files, and dependency
 * list so the agent can orient itself without exploratory reads.
 */
export function generateProjectContext(installDir: string): string {
  const lines: string[] = ['Project context summary:', ''];

  // Top-level directory listing
  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    const visible = entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.env.local')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    lines.push('Top-level files:', ...visible.map((f) => `  ${f}`), '');
  } catch {
    // Ignore
  }

  // Source directory structure (1 level deep)
  const srcDirs = ['src', 'app', 'pages', 'lib', 'components'];
  for (const dir of srcDirs) {
    const dirPath = path.join(installDir, dir);
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) continue;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const listing = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      if (listing.length > 0) {
        lines.push(`${dir}/:`, ...listing.map((f) => `  ${f}`), '');
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  // Dependencies from package.json
  const pkgPath = path.join(installDir, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      lines.push(
        'Dependencies:',
        ...Object.keys(pkg.dependencies)
          .sort()
          .map((d) => `  ${d}`),
        '',
      );
    }
    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
      lines.push(
        'Dev dependencies:',
        ...Object.keys(pkg.devDependencies)
          .sort()
          .map((d) => `  ${d}`),
        '',
      );
    }
  } catch {
    // No package.json or not parseable
  }

  // Key config files
  const configFiles = [
    'tsconfig.json',
    'next.config.js',
    'next.config.ts',
    'next.config.mjs',
    'vite.config.ts',
    'vite.config.js',
    'nuxt.config.ts',
    'astro.config.mjs',
    'svelte.config.js',
    'angular.json',
    'remix.config.js',
    'remix.config.ts',
  ];
  const foundConfigs: string[] = [];
  for (const file of configFiles) {
    try {
      fs.accessSync(path.join(installDir, file));
      foundConfigs.push(file);
    } catch {
      // Doesn't exist
    }
  }
  if (foundConfigs.length > 0) {
    lines.push('Config files:', ...foundConfigs.map((f) => `  ${f}`), '');
  }

  return lines.join('\n');
}
