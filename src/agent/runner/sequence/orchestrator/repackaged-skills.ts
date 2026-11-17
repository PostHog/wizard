/** Installs a step skill written once for every framework and completes it from the framework's pack; the sequence README's step skills passage has the rule. */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { completeSkillFromPack, skillFolder } from '@shared/skill-composition';
import {
  WIZARD_MARKER,
  installSkillById,
  type InstallSkillResult,
  type SkillScanner,
} from '@shared/skill-install';
import { fetchSkillMenu, type SkillEntry } from '@shared/skill-menu';
import {
  FRAMEWORK_KEY,
  resolveSkill,
  type MatchKeys,
} from '@shared/skill-resolution';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

const SKILL_FILE = 'SKILL.md';

/** The skill family whose pick for a run is its framework's pack, which the menu ids as `integration-<variant>`. */
export const FRAMEWORK_PACK_FAMILY = 'integration';

/** Where a tool call installs a skill, relative to the install directory. */
const TOOL_SKILLS_ROOT = path.join('.claude', 'skills');

/** Where a skill unpacks inside the temp folder it is built in. */
const STAGE_ROOT = 'skill';

/** What one run gives the installer. */
export type RepackagedSkillRun = {
  installDir: string;
  /** Where task skills install, relative to `installDir`. */
  skillsRoot: string;
  /** Whether every folder under `skillsRoot` is the wizard's own, so one already there may be replaced. */
  ownsSkillsRoot: boolean;
  /** The framework's reference skill, relative to `installDir` or absolute; undefined when the run has none. */
  referencePath: string | undefined;
  /** Installs a menu skill under `dir`; an `ok` result's path is relative to `dir`. */
  install: (skillId: string, dir: string) => Promise<InstallSkillResult>;
  /** Scans one file; a string is the reason the file is refused. */
  scanFile: (file: string) => Promise<string | null>;
  /** Called once for a skill the run cannot complete, before every task that waits on it fails. */
  onUnavailable: (skill: SkillEntry, reason: string) => void;
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Why an install did not end `ok`, with the detail a failed download carries. */
const installFailure = (
  result: Exclude<InstallSkillResult, { kind: 'ok' }>,
): string =>
  result.kind === 'download-failed'
    ? `${result.kind}: ${result.message}`
    : result.kind;

/** The folder a completed skill lands in; throws when one the wizard did not install is already there. */
function landingFolder(skill: SkillEntry, run: RepackagedSkillRun): string {
  const target = skillFolder(
    path.join(run.installDir, run.skillsRoot),
    skill.id,
    run.installDir,
  );
  const found = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!found || run.ownsSkillsRoot) return target;
  const marker = fs.lstatSync(path.join(target, WIZARD_MARKER), {
    throwIfNoEntry: false,
  });
  if (!found.isDirectory() || !marker?.isFile()) {
    throw new Error(
      `${run.skillsRoot}/${skill.id} is already there and the wizard did not install it`,
    );
  }
  return target;
}

/** Install a skill and complete it from the framework's pack; throws the reason when the run cannot use it. */
async function installCompleted(
  skill: SkillEntry,
  product: string,
  run: RepackagedSkillRun,
): Promise<string> {
  if (!run.referencePath) throw new Error('no framework pack');
  // Checked before anything is fetched, so a skill that cannot land is never downloaded.
  landingFolder(skill, run);
  // The skill is built outside the project, so an unfinished one never reaches a folder an agent reads.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-wizard-'));
  try {
    const result = await run.install(skill.id, stage);
    if (result.kind !== 'ok') throw new Error(installFailure(result));
    const staged = path.join(stage, result.path);
    completeSkillFromPack(
      staged,
      path.resolve(run.installDir, run.referencePath),
      product,
      stage,
    );
    // Completing rewrites SKILL.md, the one file no install scan has read.
    const verdict = await run
      .scanFile(path.join(staged, SKILL_FILE))
      .catch((error: unknown) => `scan failed: ${message(error)}`);
    if (verdict) throw new Error(verdict);

    // Checked again, since the install took time, then replaced whole so no earlier page survives.
    const target = landingFolder(skill, run);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(staged, target, { recursive: true });
    fs.writeFileSync(path.join(target, WIZARD_MARKER), '');
  } finally {
    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch {
      // A temp folder that will not delete is the system's to clear.
    }
  }
  return `${run.skillsRoot}/${skill.id}`;
}

/** The installer for one run: the installed path of a skill whose menu entry has `frameworkReferences`, completed from the framework's pack. It rejects with the reason when the run cannot complete the skill. */
export function repackagedSkillInstaller(
  run: RepackagedSkillRun,
): (skill: SkillEntry & { frameworkReferences: string }) => Promise<string> {
  // A skill installs once a run, so no task reads one that another is still completing.
  const installs = new Map<string, Promise<string>>();
  return (skill) => {
    const started = installs.get(skill.id);
    if (started) return started;
    // Any failure, a thrown one included, is reported once and fails every task that waits on it.
    const install = Promise.resolve()
      .then(() => installCompleted(skill, skill.frameworkReferences, run))
      .catch((error: unknown) => {
        run.onUnavailable(skill, message(error));
        throw error instanceof Error ? error : new Error(message(error));
      });
    installs.set(skill.id, install);
    return install;
  };
}

/** What a tool call gives `installToolSkill`. */
export type ToolSkillInstall = {
  installDir: string;
  skillsBaseUrl: string;
  /** The run's match keys, which pick the framework's pack. */
  matchKeys: MatchKeys;
  /** Scans an installed skill folder; a string is the reason it is refused. */
  scan: SkillScanner;
  /** Scans one file; a string is the reason the file is refused. */
  scanFile: (file: string) => Promise<string | null>;
};

/** Report a skill the run could not complete from the framework's pack. */
export function reportSkillUnavailable(
  skill: SkillEntry,
  reason: string,
  framework: string | undefined,
): void {
  logToFile(`[skills] ${skill.id} could not be completed: ${reason}`);
  analytics.wizardCapture('orchestrator repackaged skill unavailable', {
    skill: skill.id,
    reason: reason.slice(0, 200),
    framework,
  });
}

/** What a tool tells its agent about an `incomplete` result. */
export const incompleteSkillMessage = (
  skillId: string,
  reason: string,
): string =>
  `Error installing skill "${skillId}": it is completed from the project's framework pack, and that failed (${reason}).`;

/** `incomplete`: the skill is completed from the framework's pack, and the run could not complete it. */
export type ToolSkillResult =
  | InstallSkillResult
  | { kind: 'incomplete'; skillId: string; reason: string };

/** Install the menu skill `skillId` for a tool call: as published, or completed from the framework's pack when its entry has `frameworkReferences`. */
export async function installToolSkill(
  skillId: string,
  run: ToolSkillInstall,
): Promise<ToolSkillResult> {
  const menu = await fetchSkillMenu(run.skillsBaseUrl);
  if (!menu) return { kind: 'menu-fetch-failed' };
  const entries = Object.values(menu.categories).flat();
  const skill = entries.find((entry) => entry.id === skillId);
  if (!skill) return { kind: 'skill-not-found', skillId };
  const install = (id: string, installDir = run.installDir, root?: string) =>
    installSkillById(id, installDir, run.skillsBaseUrl, {
      skillsRoot: root,
      scan: run.scan,
    });
  const { frameworkReferences } = skill;
  if (!frameworkReferences) return install(skill.id);
  const onUnavailable = (unavailable: SkillEntry, reason: string) =>
    reportSkillUnavailable(
      unavailable,
      reason,
      run.matchKeys[FRAMEWORK_KEY]?.[0],
    );

  // The pack is read once and thrown away, so it never lands in the project.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-wizard-'));
  try {
    const pack = resolveSkill(entries, FRAMEWORK_PACK_FAMILY, run.matchKeys);
    const packInstall = pack && (await install(pack.id, scratch, 'pack'));
    if (packInstall && packInstall.kind !== 'ok') {
      const reason = `the framework pack did not install: ${packInstall.kind}`;
      onUnavailable(skill, reason);
      return { kind: 'incomplete', skillId, reason };
    }
    const complete = repackagedSkillInstaller({
      installDir: run.installDir,
      skillsRoot: TOOL_SKILLS_ROOT,
      // `.claude/skills` is the project's, so a folder there is replaced only when the wizard installed it.
      ownsSkillsRoot: false,
      referencePath: packInstall && path.join(scratch, packInstall.path),
      install: (id, dir) => install(id, dir, STAGE_ROOT),
      scanFile: run.scanFile,
      onUnavailable,
    });
    return {
      kind: 'ok',
      path: await complete({ ...skill, frameworkReferences }),
    };
  } catch (error) {
    return { kind: 'incomplete', skillId, reason: message(error) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
