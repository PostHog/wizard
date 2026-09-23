import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
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
  const digest = createHash('sha256');
  const files = fg.sync(SKILL_TEXT_GLOB, {
    cwd: skillDir,
    absolute: true,
  });
  for (const file of files.sort()) {
    digest.update(path.relative(skillDir, file));
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }
  return digest.digest('hex');
}

export async function scanProjectSkills(
  workingDirectory: string,
  triageProvider: LLMProvider | undefined,
): Promise<ProjectSkillFinding[]> {
  const root = path.join(workingDirectory, '.claude', 'skills');
  if (!fs.existsSync(root)) return [];

  const findings: ProjectSkillFinding[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const skillDir = path.join(root, entry.name);
    if (!entry.isDirectory() && !fs.statSync(skillDir).isDirectory()) continue;

    const fingerprint = fingerprintSkill(skillDir);
    const cached = cleanScans.get(skillDir);
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
      cleanScans.delete(skillDir);
      throw new Error(
        `Project skill ${entry.name} changed during security scan`,
      );
    }
    if (reason) {
      cleanScans.delete(skillDir);
      findings.push({ skillDir, reason });
    } else {
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
  }
  return findings;
}
