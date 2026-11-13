/** Records a context-mill release as the fixtures the behavior checks compare against; see scripts/README.md. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE_URL =
  process.argv[2] ??
  'https://github.com/PostHog/context-mill/releases/latest/download';
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'context-mill',
);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** The menu's build version. Throws on text that is not a skill menu. */
function menuVersion(text: string): string | undefined {
  const menu = JSON.parse(text) as {
    buildVersion?: string;
    categories?: unknown;
  };
  if (typeof menu.categories !== 'object' || menu.categories === null) {
    throw new Error(`${BASE_URL}/skill-menu.json is not a skill menu`);
  }
  return menu.buildVersion;
}

async function main(): Promise<void> {
  const skillMenu = await fetchText(`${BASE_URL}/skill-menu.json`);
  // Read before anything is written, so a response that is not a menu leaves the fixture alone.
  const version = menuVersion(skillMenu);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'skill-menu.json'), skillMenu);

  console.log(
    `Recorded context-mill ${version ?? 'unknown version'} into ${path.relative(
      process.cwd(),
      OUT_DIR,
    )}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
