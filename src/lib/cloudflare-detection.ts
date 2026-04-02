import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';
import { logToFile } from '../utils/debug';

/**
 * Detect whether the project targets Cloudflare Workers.
 *
 * Checks for:
 * 1. wrangler.toml / wrangler.jsonc / wrangler.json in project root
 * 2. Cloudflare adapter packages in dependencies (@react-router/cloudflare,
 *    @astrojs/cloudflare, @sveltejs/adapter-cloudflare, etc.)
 */
export async function detectCloudflareTarget(
  installDir: string,
): Promise<boolean> {
  // Check for wrangler config files
  const wranglerFiles = await fg('wrangler.@(toml|jsonc|json)', {
    cwd: installDir,
    dot: true,
  });
  if (wranglerFiles.length > 0) {
    logToFile(
      `[cloudflare-detection] detected via wrangler config: ${wranglerFiles[0]}`,
    );
    return true;
  }

  // Check for Cloudflare adapter/platform packages in deps
  try {
    const packageJsonPath = path.join(installDir, 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const cloudflarePackages = Object.keys(allDeps).filter(
      (dep) =>
        dep === '@react-router/cloudflare' ||
        dep === '@astrojs/cloudflare' ||
        dep === '@sveltejs/adapter-cloudflare' ||
        dep === '@sveltejs/adapter-cloudflare-workers' ||
        dep === '@cloudflare/workers-types' ||
        dep === 'wrangler',
    );

    if (cloudflarePackages.length > 0) {
      logToFile(
        `[cloudflare-detection] detected via packages: ${cloudflarePackages.join(
          ', ',
        )}`,
      );
      return true;
    }
  } catch {
    // package.json not found or invalid
  }

  return false;
}

/**
 * Fetch the Cloudflare Workers reference from the skills server.
 * Returns the markdown content, or null on failure.
 */
export async function fetchCloudflareReference(
  skillsBaseUrl: string,
): Promise<string | null> {
  try {
    const url = `${skillsBaseUrl}/cloudflare-workers.md`;
    logToFile(`[cloudflare-detection] fetching reference from ${url}`);
    const resp = await fetch(url);
    if (resp.ok) {
      const text = await resp.text();
      logToFile(
        `[cloudflare-detection] loaded reference (${text.length} chars)`,
      );
      return text;
    }
    logToFile(
      `[cloudflare-detection] reference fetch failed: HTTP ${resp.status}`,
    );
    return null;
  } catch (err: any) {
    logToFile(`[cloudflare-detection] reference fetch error: ${err.message}`);
    return null;
  }
}
