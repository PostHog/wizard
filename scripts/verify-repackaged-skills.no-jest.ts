/** Checks that a run reads the same documents from the repackaged skills as from the skills they replace; see scripts/README.md. */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';
import {
  VARIANT_FILE,
  composeStepSkill,
  type SkillFiles,
} from '@shared/skill-composition';
import type { SkillBundle } from '@shared/skill-install';
import {
  expandBundleEntry,
  type SkillEntry,
  type SkillMenu,
} from '@shared/skill-menu';
import {
  FRAMEWORK_KEY,
  resolveReplacement,
  resolveSkill,
} from '@shared/skill-resolution';

const ARGS = process.argv.slice(2);
const SOURCE =
  ARGS.find((arg) => !arg.startsWith('--')) ??
  'https://github.com/PostHog/context-mill/releases/latest/download';
/** With `--record`, one matching pair is written as the fixture the composition test reads. */
const RECORD = ARGS.includes('--record');
const FIXTURE = { name: 'integration-v2-init', framework: 'flask' };
const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'context-mill',
  'repackaged',
);
/** The skill family whose pick is the run's framework pack. */
const PACK_FAMILY = 'integration';
const SKILL_FILE = 'SKILL.md';

const cache = new Map<string, Promise<Uint8Array>>();

/** One published file, from a build's `dist/skills` folder or a release's download URL. */
function load(name: string): Promise<Uint8Array> {
  let loading = cache.get(name);
  if (!loading) {
    loading = /^https?:\/\//.test(SOURCE)
      ? fetch(`${SOURCE}/${name}`).then(async (response) => {
          if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        })
      : fs.promises.readFile(path.join(SOURCE, name));
    cache.set(name, loading);
  }
  return loading;
}

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

/** The files a menu entry installs: its zip's, or its variant's inside a bundle. */
async function filesOf(entry: SkillEntry): Promise<SkillFiles> {
  const data = await load(path.posix.basename(entry.downloadUrl));
  if (entry.bundle) {
    const bundle = JSON.parse(text(data)) as SkillBundle;
    const files = bundle.variants[entry.id.slice(bundle.id.length + 1)];
    if (!files) throw new Error(`${bundle.id} has no variant ${entry.id}`);
    return files;
  }
  return Object.fromEntries(
    Object.entries(unzipSync(data))
      .filter(([file]) => !file.endsWith('/'))
      .map(([file, contents]) => [file, text(contents)]),
  );
}

const hash = (contents: string): string =>
  createHash('sha256').update(contents).digest('hex');

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n?/;

/** A SKILL.md without its frontmatter. */
const body = (skill: string): string => skill.replace(FRONTMATTER, '');

/** A SKILL.md's frontmatter without `name`, the one field a skill and its replacement must differ in. */
const frontmatter = (skill: string): string =>
  (FRONTMATTER.exec(skill)?.[1] ?? '')
    .split('\n')
    .filter((line) => !line.startsWith('name:'))
    .join('\n');

/** What differs between the files a task reads today and the files it reads from the replacement. */
function compare(today: SkillFiles, repackaged: SkillFiles): string[] {
  const differences: string[] = [];
  for (const file of new Set([
    ...Object.keys(today),
    ...Object.keys(repackaged),
  ])) {
    if (!Object.hasOwn(repackaged, file)) differences.push(`${file} is gone`);
    else if (!Object.hasOwn(today, file)) differences.push(`${file} is new`);
    else if (file === SKILL_FILE) {
      if (body(today[file]) !== body(repackaged[file])) {
        differences.push(`${SKILL_FILE} reads differently`);
      }
      if (frontmatter(today[file]) !== frontmatter(repackaged[file])) {
        differences.push(`${SKILL_FILE} frontmatter differs`);
      }
    } else if (hash(today[file]) !== hash(repackaged[file])) {
      differences.push(`${file} differs`);
    }
  }
  return differences;
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

/** One pair as recorded: the step as published, what completing it reads from the pack, and the skill it replaces. */
type RecordedPair = {
  pair: Record<string, string | undefined>;
  step: SkillFiles;
  pack: SkillFiles;
  original: SkillFiles;
};

function writeFixture(recorded: RecordedPair): void {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  for (const folder of ['step', 'pack', 'original'] as const) {
    for (const [file, contents] of Object.entries(recorded[folder])) {
      const target = path.join(FIXTURE_DIR, folder, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }
  }
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'pair.json'),
    `${JSON.stringify(recorded.pair, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const menu = JSON.parse(text(await load('skill-menu.json'))) as SkillMenu;
  const entries = Object.values(menu.categories)
    .flat()
    .flatMap(expandBundleEntry);
  const frameworks = [
    ...new Set(
      entries
        .filter((entry) => entry.group === PACK_FAMILY && entry.framework)
        .map((entry) => entry.framework as string),
    ),
  ].sort();
  const replaced = [
    ...new Set(
      entries.flatMap((entry) => (entry.replaces ? [entry.replaces] : [])),
    ),
  ].sort();
  if (replaced.length === 0) {
    throw new Error(`The menu at ${SOURCE} has no entry with \`replaces\`.`);
  }

  let pairs = 0;
  let recorded: RecordedPair | undefined;
  const differing: string[] = [];
  for (const name of replaced) {
    const replacement = resolveReplacement(entries, name) as SkillEntry;
    const product = replacement.frameworkReferences;
    // One skill with a replacement no pack completes reads the same for every framework, so it is compared once.
    const oneSkill = entries.some((entry) => entry.id === name);
    let compared = 0;
    for (const framework of oneSkill && !product ? [undefined] : frameworks) {
      const keys = { [FRAMEWORK_KEY]: framework ? [framework] : undefined };
      const today = resolveSkill(entries, name, keys);
      if (!today) continue;
      pairs += 1;
      compared += 1;
      const label = `${name} on ${framework ?? 'every framework'}`;
      try {
        const step = await filesOf(replacement);
        const pack = product
          ? resolveSkill(entries, PACK_FAMILY, keys)
          : undefined;
        if (product && !pack) throw new Error('no pack for the framework');
        const packFiles = pack ? await filesOf(pack) : undefined;
        const repackaged =
          product && packFiles
            ? composeStepSkill(step, packFiles, product)
            : step;
        const original = await filesOf(today);
        const differences = compare(original, repackaged);
        if (differences.length > 0) {
          differing.push(`${label} (${today.id}): ${differences.join('; ')}`);
        } else if (
          product &&
          pack &&
          packFiles &&
          name === FIXTURE.name &&
          framework === FIXTURE.framework
        ) {
          recorded = {
            pair: {
              replaces: name,
              framework,
              product,
              original: today.id,
              step: replacement.id,
              pack: pack.id,
              contextMill: menu.buildVersion,
            },
            step,
            pack: packFilesRead(packFiles, product),
            original,
          };
        }
      } catch (error) {
        differing.push(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (compared === 0) {
      differing.push(`${name}: no skill to compare its replacement with`);
    }
  }

  console.log(
    `${replaced.length} skills have a replacement. Compared ${pairs} skill and framework pairs across ${frameworks.length} frameworks.`,
  );
  if (RECORD) {
    if (!recorded) {
      throw new Error(
        `Nothing recorded: ${FIXTURE.name} on ${FIXTURE.framework} has no matching pair at ${SOURCE}.`,
      );
    }
    writeFixture(recorded);
    console.log(
      `Recorded ${FIXTURE.name} on ${FIXTURE.framework} into ${path.relative(
        process.cwd(),
        FIXTURE_DIR,
      )}.`,
    );
  }
  if (differing.length === 0) {
    console.log('Every pair reads the same documents both ways.');
    return;
  }
  console.log(`${differing.length} differences:`);
  for (const line of differing) console.log(`  - ${line}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
