/**
 * Language detection for setup-revenue-analytics.
 *
 * Reuses the existing framework detection from the wizard, mapping
 * detected integrations to base languages. Falls back to scanning
 * for language indicator files when framework detection fails.
 */

import { Integration } from '../lib/constants';
import type { Language } from './types';
import fg from 'fast-glob';

const INTEGRATION_TO_LANGUAGE: Record<Integration, Language | null> = {
  [Integration.nextjs]: 'node',
  [Integration.nuxt]: 'node',
  [Integration.vue]: 'node',
  [Integration.reactRouter]: 'node',
  [Integration.tanstackStart]: 'node',
  [Integration.tanstackRouter]: 'node',
  [Integration.reactNative]: 'node',
  [Integration.angular]: 'node',
  [Integration.astro]: 'node',
  [Integration.sveltekit]: 'node',
  [Integration.javascript_web]: 'node',
  [Integration.javascriptNode]: 'node',
  [Integration.django]: 'python',
  [Integration.flask]: 'python',
  [Integration.fastapi]: 'python',
  [Integration.python]: 'python',
  [Integration.laravel]: 'php',
  [Integration.rails]: 'ruby',
  [Integration.ruby]: 'ruby',
  [Integration.swift]: null,
  [Integration.android]: null,
};

interface LanguageIndicator {
  language: Language;
  patterns: string[];
}

const LANGUAGE_INDICATORS: LanguageIndicator[] = [
  { language: 'node', patterns: ['package.json'] },
  {
    language: 'python',
    patterns: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'],
  },
  { language: 'ruby', patterns: ['Gemfile'] },
  { language: 'php', patterns: ['composer.json'] },
  { language: 'go', patterns: ['go.mod'] },
  {
    language: 'java',
    patterns: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
  },
  { language: 'dotnet', patterns: ['*.csproj', '*.sln'] },
];

export function languageFromIntegration(
  integration: Integration,
): Language | null {
  return INTEGRATION_TO_LANGUAGE[integration] ?? null;
}

export async function detectLanguageFromFiles(
  installDir: string,
): Promise<Language | null> {
  for (const { language, patterns } of LANGUAGE_INDICATORS) {
    const matches = await fg(patterns, {
      cwd: installDir,
      deep: 1,
      onlyFiles: true,
    });
    if (matches.length > 0) {
      return language;
    }
  }
  return null;
}

/**
 * Detect the codebase language. Tries framework detection first,
 * then falls back to file-based detection.
 */
export async function detectLanguage(
  installDir: string,
): Promise<Language | null> {
  const { detectIntegration } = await import('../run.js');
  const integration = await detectIntegration(installDir);

  if (integration) {
    const language = languageFromIntegration(integration);
    if (language) return language;
  }

  return detectLanguageFromFiles(installDir);
}
