/** Records a context-mill release as the fixtures the behavior checks compare against; see scripts/README.md. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';
import {
  VARIANT_FILE,
  composeStepSkill,
  type SkillFiles,
} from '@shared/skill-composition';
import type { SkillEntry, SkillMenu } from '@shared/skill-menu';
import { FRAMEWORK_KEY, resolveSkill } from '@shared/skill-resolution';

const BASE_URL =
  process.argv[2] ??
  'https://github.com/PostHog/context-mill/releases/latest/download';
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'context-mill',
);
const PAIR_DIR = path.join(OUT_DIR, 'repackaged');

/** The step skill and framework recorded as a pair, and the skill family whose pick is the framework's pack. */
const PAIR = { step: 'integration-init', framework: 'flask' };
const PACK_FAMILY = 'integration';

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

/** The menu. Throws on text that is not a skill menu. */
function parseMenu(raw: string): SkillMenu {
  const menu = JSON.parse(raw) as SkillMenu;
  if (typeof menu.categories !== 'object' || menu.categories === null) {
    throw new Error(`${BASE_URL}/skill-menu.json is not a skill menu`);
  }
  return menu;
}

/** The files a menu entry's zip installs, read beside the menu so a base URL other than the release's works. */
async function filesOf(entry: SkillEntry): Promise<SkillFiles> {
  const data = await fetchBytes(
    `${BASE_URL}/${path.posix.basename(entry.downloadUrl)}`,
  );
  return Object.fromEntries(
    Object.entries(unzipSync(data))
      .filter(([file]) => !file.endsWith('/'))
      .map(([file, contents]) => [file, text(contents)]),
  );
}

/** The files of a pack that completing a skill reads: its variant.json, the product's pages and its rules file. */
function packFilesRead(pack: SkillFiles, product: string): SkillFiles {
  const variant = JSON.parse(pack[VARIANT_FILE]) as {
    rules: { file: string } | null;
    products: Record<string, { file: string }[]>;
  };
  const names = [
    VARIANT_FILE,
    ...variant.products[product].map((page) => page.file),
    ...(variant.rules ? [variant.rules.file] : []),
  ];
  return Object.fromEntries(names.map((name) => [name, pack[name]]));
}

/** Where a recorded file goes. Throws unless it stays inside its folder of the fixture, so a published file name cannot write anywhere else. */
function pairFile(folder: string, file: string): string {
  const root = path.join(PAIR_DIR, folder);
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) {
    throw new Error(`${file} would be recorded outside ${root}`);
  }
  return target;
}

async function main(): Promise<void> {
  const skillMenu = text(await fetchBytes(`${BASE_URL}/skill-menu.json`));
  // Read before anything is written, so a response that is not a menu leaves the fixtures alone.
  const menu = parseMenu(skillMenu);
  const entries = Object.values(menu.categories).flat();
  const step = entries.find((entry) => entry.id === PAIR.step);
  const product = step?.frameworkReferences;
  const pack = resolveSkill(entries, PACK_FAMILY, {
    [FRAMEWORK_KEY]: [PAIR.framework],
  });
  if (!step || !product || !pack) {
    throw new Error(
      `${BASE_URL} has no ${PAIR.step} to complete, or no pack for ${PAIR.framework}.`,
    );
  }
  const stepFiles = await filesOf(step);
  const packFiles = await filesOf(pack);
  const recorded = {
    step: stepFiles,
    pack: packFilesRead(packFiles, product),
    completed: composeStepSkill(stepFiles, packFiles, product),
  };
  // Every destination is checked before a fixture is replaced or a file is written.
  const writes = (['step', 'pack', 'completed'] as const).flatMap((folder) =>
    Object.entries(recorded[folder]).map(
      ([file, contents]) => [pairFile(folder, file), contents] as const,
    ),
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'skill-menu.json'), skillMenu);
  fs.rmSync(PAIR_DIR, { recursive: true, force: true });
  for (const [target, contents] of writes) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  fs.writeFileSync(
    path.join(PAIR_DIR, 'pair.json'),
    `${JSON.stringify(
      {
        framework: PAIR.framework,
        product,
        step: step.id,
        pack: pack.id,
        contextMill: menu.buildVersion,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `Recorded context-mill ${
      menu.buildVersion ?? 'unknown version'
    }: the skill menu, and ${step.id} with ${pack.id}, into ${path.relative(
      process.cwd(),
      OUT_DIR,
    )}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
