/**
 * Install PostHog integration skill from GitHub (context-mill) when showing the outage screen.
 * Downloads the release asset zip and extracts to installDir/.claude/skills/<skillId>/.
 * Uses the system unzip command (no extra npm dependency).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import type { Integration } from './constants.js';

const GITHUB_API_LATEST =
  'https://api.github.com/repos/PostHog/context-mill/releases/latest';

const INTEGRATION_TO_SKILL_ASSET: Partial<Record<Integration, string>> = {
  android: 'integration-android',
  angular: 'integration-angular',
  astro: 'integration-astro-static',
  django: 'integration-django',
  fastapi: 'integration-fastapi',
  flask: 'integration-flask',
  javascript_web: 'integration-javascript_web',
  javascript_node: 'integration-javascript_node',
  laravel: 'integration-laravel',
  nextjs: 'integration-nextjs-app-router',
  nuxt: 'integration-nuxt-4',
  python: 'integration-python',
  rails: 'integration-ruby-on-rails',
  'react-native': 'integration-react-native',
  'react-router': 'integration-react-react-router-7-framework',
  ruby: 'integration-ruby',
  sveltekit: 'integration-sveltekit',
  swift: 'integration-swift',
  'tanstack-router': 'integration-react-tanstack-router-file-based',
  'tanstack-start': 'integration-tanstack-start',
  vue: 'integration-vue-3',
};

export function getSkillAssetNameForIntegration(
  integration: string,
): string | undefined {
  return INTEGRATION_TO_SKILL_ASSET[integration as Integration];
}

export async function installPostHogSkillForOutage(
  installDir: string,
  integration: string,
): Promise<'installed' | 'failed'> {
  const assetName = getSkillAssetNameForIntegration(integration);
  if (!assetName) return 'failed';
  const baseName = `${assetName}.zip`;

  try {
    const releaseRes = await fetch(GITHUB_API_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!releaseRes.ok) return 'failed';
    const release = (await releaseRes.json()) as {
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const asset = release.assets?.find((a) => a.name === baseName);
    if (!asset) return 'failed';

    const zipRes = await fetch(asset.browser_download_url);
    if (!zipRes.ok) return 'failed';
    const buf = Buffer.from(await zipRes.arrayBuffer());

    const skillsDir = path.resolve(installDir, '.claude', 'skills');
    const skillId = assetName;
    const targetDir = path.resolve(skillsDir, skillId);
    const tmpDir = path.join(
      os.tmpdir(),
      `posthog-wizard-skill-${skillId}-${Date.now()}`,
    );
    const zipPath = path.join(tmpDir, baseName);

    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(zipPath, buf);

    try {
      execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmpDir], {
        stdio: 'pipe',
      });
    } finally {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        // ignore
      }
    }

    const entries = fs.readdirSync(tmpDir);
    const singleRoot =
      entries.length === 1 &&
      fs.statSync(path.join(tmpDir, entries[0])).isDirectory();
    const extractRoot = singleRoot ? path.join(tmpDir, entries[0]) : tmpDir;

    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of fs.readdirSync(extractRoot)) {
      const src = path.join(extractRoot, name);
      const dest = path.join(targetDir, name);
      fs.renameSync(src, dest);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return 'installed';
  } catch {
    return 'failed';
  }
}
