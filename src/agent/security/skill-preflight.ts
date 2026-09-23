import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import fg from 'fast-glob';
import type { LLMProvider } from '@posthog/warlock';
import { scanInstalledSkill, SKILL_TEXT_GLOB } from './yara-hooks';

export type ProjectSkillFinding = {
  skillDir: string;
  reason: string;
};

/** Check project skills before the SDK can add them to agent context. */
const cleanScans = new Map<
  string,
  { fingerprint: string; hasTriageProvider: boolean }
>();
const MAX_CLEAN_SCANS = 256;

function fingerprintSkill(skillDir: string): string {
  if (!fs.statSync(skillDir).isDirectory()) {
    throw new Error(`Project skill path is not a directory: ${skillDir}`);
  }
  const digest = createHash('sha256');
  const files = fg.sync(SKILL_TEXT_GLOB, {
    cwd: skillDir,
    absolute: true,
    caseSensitiveMatch: false,
  });
  for (const file of files.sort()) {
    digest.update(path.relative(skillDir, file));
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function rememberCleanScan(
  skillDir: string,
  fingerprint: string,
  triageProvider: LLMProvider | undefined,
): void {
  cleanScans.delete(skillDir);
  cleanScans.set(skillDir, {
    fingerprint,
    hasTriageProvider: triageProvider !== undefined,
  });
  if (cleanScans.size > MAX_CLEAN_SCANS) {
    for (const oldest of cleanScans.keys()) {
      cleanScans.delete(oldest);
      break;
    }
  }
}

/** Reuse the install scan only when it covered the same bytes preflight will see. */
export async function scanAndCacheInstalledProjectSkill(
  skillDir: string,
  triageProvider: LLMProvider | undefined,
): Promise<string | null> {
  const cacheKey = normalizeSkillDir(skillDir);
  const fingerprint = fingerprintSkill(skillDir);
  const reason = await scanInstalledSkill(skillDir, triageProvider);
  if (fingerprintSkill(skillDir) !== fingerprint) {
    cleanScans.delete(cacheKey);
    throw new Error(`Project skill ${skillDir} changed during security scan`);
  }
  if (reason) cleanScans.delete(cacheKey);
  else rememberCleanScan(cacheKey, fingerprint, triageProvider);
  return reason;
}

export function forgetCleanProjectSkill(skillDir: string): void {
  cleanScans.delete(normalizeSkillDir(skillDir));
}

function normalizeSkillDir(skillDir: string): string {
  const absolute = path.resolve(skillDir);
  try {
    return path.join(
      fs.realpathSync(path.dirname(absolute)),
      path.basename(absolute),
    );
  } catch {
    return absolute;
  }
}

function projectSkillRoots(workingDirectory: string): string[] {
  const cwd = fs.realpathSync(workingDirectory);
  const home = fs.realpathSync(os.homedir());
  let repoRoot = cwd;
  try {
    const discovered = fs.realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
    if (cwd === discovered || cwd.startsWith(`${discovered}${path.sep}`)) {
      repoRoot = discovered;
    }
  } catch {
    // Without a repository, only the explicit SDK working directory is known.
  }

  const roots: string[] = [];
  for (let directory = cwd; directory !== home; ) {
    roots.push(path.join(directory, '.claude', 'skills'));
    if (directory === repoRoot) break;
    directory = path.dirname(directory);
  }
  return roots;
}

export async function scanProjectSkills(
  workingDirectory: string,
  triageProvider: LLMProvider | undefined,
): Promise<ProjectSkillFinding[]> {
  const findings: ProjectSkillFinding[] = [];
  for (const root of projectSkillRoots(workingDirectory)) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const skillDir = path.join(root, entry.name);
      if (
        !entry.isDirectory() &&
        !fs.statSync(skillDir, { throwIfNoEntry: false })?.isDirectory()
      ) {
        continue;
      }

      const cacheKey = normalizeSkillDir(skillDir);
      const fingerprint = fingerprintSkill(skillDir);
      const cached = cleanScans.get(cacheKey);
      if (
        cached?.fingerprint === fingerprint &&
        cached.hasTriageProvider === (triageProvider !== undefined)
      ) {
        continue;
      }

      const reason = await scanInstalledSkill(
        skillDir,
        triageProvider,
        'skill-load',
      );
      if (fingerprintSkill(skillDir) !== fingerprint) {
        cleanScans.delete(cacheKey);
        throw new Error(
          `Project skill ${entry.name} changed during security scan`,
        );
      }
      if (reason) {
        cleanScans.delete(cacheKey);
        findings.push({ skillDir, reason });
      } else {
        rememberCleanScan(cacheKey, fingerprint, triageProvider);
      }
    }
  }
  return findings;
}
