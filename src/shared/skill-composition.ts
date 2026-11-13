/** Skill composition: completing a step skill written once for every framework from that framework's pack. The README's `@shared/skill-composition` entry has the contract. */

import fs from 'fs';
import path from 'path';

/** The file at a pack's root that lists its rules file and each product's pages. */
export const VARIANT_FILE = 'variant.json';

/** What a step skill leaves in SKILL.md for its consumer: the framework's name inline, and a line each for its pages and its rules. */
export const FRAMEWORK_NAME = '{framework_name}';
export const FRAMEWORK_DOCS = '{framework_docs}';
export const FRAMEWORK_RULES = '{framework_rules}';

const SKILL_FILE = 'SKILL.md';
const REFERENCES_DIR = 'references';

/** A skill's files, keyed by their path from its root with `/` separators. */
export type SkillFiles = Record<string, string>;

/** One file a pack lists, with the words its line in SKILL.md carries. */
type PackReference = { file: string; description: string };

/** A pack's `variant.json`, as far as composition reads it. */
type PackVariant = {
  id: string;
  displayName: string;
  rules: PackReference | null;
  products: Record<string, PackReference[] | undefined>;
};

const isReference = (value: unknown): value is PackReference =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PackReference).file === 'string' &&
  typeof (value as PackReference).description === 'string';

/** Parse a pack's `variant.json`, failing on anything composition cannot read. */
function parseVariant(text: string): PackVariant {
  const variant = JSON.parse(text) as Partial<PackVariant> | null;
  const products = variant?.products;
  if (
    typeof variant?.id !== 'string' ||
    typeof variant.displayName !== 'string' ||
    typeof products !== 'object' ||
    products === null ||
    (variant.rules !== null && !isReference(variant.rules))
  ) {
    throw new Error(`malformed ${VARIANT_FILE}`);
  }
  return variant as PackVariant;
}

/** Where a pack's file lands in the skill: `references/<name>`, whatever folder the pack keeps it in. */
function referencePath(file: string): string {
  const name = path.posix.basename(file);
  if (!name || name === '.' || name === '..' || name.includes('\\')) {
    throw new Error(`unusable reference name: ${file}`);
  }
  return `${REFERENCES_DIR}/${name}`;
}

const referenceLine = (target: string, description: string): string =>
  `- \`${target}\` - ${description}`;

/**
 * A step skill's files, completed from a pack's files. Files land in the order
 * context-mill builds a variant: the product's pages, the step's own files, then
 * the rules, and a later file replaces an earlier one of the same name.
 */
export function composeStepSkill(
  stepFiles: SkillFiles,
  packFiles: SkillFiles,
  product: string,
): SkillFiles {
  if (!Object.hasOwn(packFiles, VARIANT_FILE)) {
    throw new Error(`the pack has no ${VARIANT_FILE}`);
  }
  if (!Object.hasOwn(stepFiles, SKILL_FILE)) {
    throw new Error(`the skill has no ${SKILL_FILE}`);
  }
  const variant = parseVariant(packFiles[VARIANT_FILE]);
  const pages = Object.hasOwn(variant.products, product)
    ? variant.products[product]
    : undefined;
  if (!Array.isArray(pages) || !pages.every(isReference)) {
    throw new Error(`the pack "${variant.id}" lists no ${product} pages`);
  }
  const take = (file: string): string => {
    if (!Object.hasOwn(packFiles, file)) {
      throw new Error(`the pack "${variant.id}" lists ${file} without it`);
    }
    return packFiles[file];
  };

  const files: SkillFiles = {};
  const docLines: string[] = [];
  for (const page of pages) {
    const target = referencePath(page.file);
    files[target] = take(page.file);
    docLines.push(referenceLine(target, page.description));
  }
  Object.assign(files, stepFiles);
  const ruleLines: string[] = [];
  if (variant.rules) {
    const target = referencePath(variant.rules.file);
    files[target] = take(variant.rules.file);
    ruleLines.push(referenceLine(target, variant.rules.description));
  }

  files[SKILL_FILE] = stepFiles[SKILL_FILE].split('\n')
    .flatMap((line) =>
      line === FRAMEWORK_DOCS
        ? docLines
        : line === FRAMEWORK_RULES
        ? ruleLines
        : [line],
    )
    .join('\n')
    .replaceAll(FRAMEWORK_NAME, variant.displayName);
  return files;
}

/** Every file under `dir`, keyed by its path from `dir` with `/` separators. */
function readFiles(dir: string, prefix = ''): SkillFiles {
  const files: SkillFiles = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, readFiles(abs, `${key}/`));
    else if (entry.isFile()) files[key] = fs.readFileSync(abs, 'utf8');
  }
  return files;
}

/** Opens a file for writing and refuses a link at its last component, where the platform can. */
const WRITE_NO_FOLLOW =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_TRUNC |
  (fs.constants.O_NOFOLLOW ?? 0);

/** The path of `file` under `boundary`, refused when it leaves the boundary or passes through a link. */
function plainPath(boundary: string, file: string): string {
  const base = path.resolve(boundary);
  const target = path.resolve(base, file);
  if (!target.startsWith(base + path.sep)) {
    throw new Error(`a composed file escapes the skill: ${file}`);
  }
  const parts = path.relative(base, target).split(path.sep);
  let current = base;
  parts.forEach((part, index) => {
    current = path.join(current, part);
    const found = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!found) return;
    const plain =
      index === parts.length - 1 ? found.isFile() : found.isDirectory();
    if (!plain) {
      throw new Error(
        `a composed file would be written through a link: ${file}`,
      );
    }
  });
  return target;
}

/** Complete the step skill at `skillDir` from the pack at `packDir`, writing through no link below `boundaryDir`; throws and leaves the skill as it was otherwise. */
export function completeSkillFromPack(
  skillDir: string,
  packDir: string,
  product: string,
  boundaryDir: string,
): void {
  const stepFiles = readFiles(skillDir);
  const composed = composeStepSkill(stepFiles, readFiles(packDir), product);
  const fromBoundary = path.relative(
    path.resolve(boundaryDir),
    path.resolve(skillDir),
  );
  // The skill's own folder is checked even when nothing is written, so a caller can trust its path.
  plainPath(boundaryDir, path.join(fromBoundary, SKILL_FILE));
  // Every target is checked before the first write, so a refusal leaves the skill untouched.
  const writes = Object.entries(composed)
    .filter(([file, contents]) => stepFiles[file] !== contents)
    .map(
      ([file, contents]) =>
        [
          plainPath(boundaryDir, path.join(fromBoundary, file)),
          contents,
        ] as const,
    );
  for (const [target, contents] of writes) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const file = fs.openSync(target, WRITE_NO_FOLLOW);
    try {
      fs.writeFileSync(file, contents);
    } finally {
      fs.closeSync(file);
    }
  }
}
