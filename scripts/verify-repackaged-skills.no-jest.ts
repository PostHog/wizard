/** Checks that a run reads the same documents from the repackaged skills as from the skills they replace; see scripts/README.md. */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import { composeStepSkill, type SkillFiles } from '@shared/skill-composition';
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

const SOURCE =
  process.argv[2] ??
  'https://github.com/PostHog/context-mill/releases/latest/download';
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

/** A SKILL.md without its frontmatter, which names the skill and so differs between a skill and its replacement. */
const body = (skill: string): string =>
  skill.replace(/^---\n[\s\S]*?\n---\n\n?/, '');

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
    } else if (hash(today[file]) !== hash(repackaged[file])) {
      differences.push(`${file} differs`);
    }
  }
  return differences;
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
  const differing: string[] = [];
  for (const name of replaced) {
    const replacement = resolveReplacement(entries, name) as SkillEntry;
    const product = replacement.frameworkReferences;
    // A skill that reads the same for every framework is compared once.
    for (const framework of product ? frameworks : [undefined]) {
      const keys = { [FRAMEWORK_KEY]: framework ? [framework] : undefined };
      const today = resolveSkill(entries, name, keys);
      if (!today) continue;
      pairs += 1;
      const label = `${name} on ${framework ?? 'every framework'}`;
      try {
        let repackaged = await filesOf(replacement);
        if (product) {
          const pack = resolveSkill(entries, PACK_FAMILY, keys);
          if (!pack) throw new Error('no pack for the framework');
          repackaged = composeStepSkill(
            repackaged,
            await filesOf(pack),
            product,
          );
        }
        const differences = compare(await filesOf(today), repackaged);
        if (differences.length > 0) {
          differing.push(`${label} (${today.id}): ${differences.join('; ')}`);
        }
      } catch (error) {
        differing.push(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  console.log(
    `${replaced.length} skills have a replacement. Compared ${pairs} skill and framework pairs across ${frameworks.length} frameworks.`,
  );
  if (differing.length === 0) {
    console.log('Every pair reads the same documents both ways.');
    return;
  }
  console.log(`${differing.length} pairs read different documents:`);
  for (const line of differing) console.log(`  - ${line}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
