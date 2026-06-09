import { CLI_MANIFEST } from '@lib/programs/cli-manifest.generated';
import { auditConfig } from '@lib/programs/audit/index';
import { agentSkillConfig } from '@lib/programs/program-registry';
import { webAnalyticsDoctorConfig } from '@lib/programs/web-analytics-doctor/index';

import type { Command } from './command';
import { nativeCommandFactory } from './factories/native-command-factory';
import { skillCommandFactory } from './factories/skill-command-factory';

/**
 * The `wizard audit` family. Children come from two places:
 *
 *   1. Manifest entries with `parentCommand: 'audit'` — six skill-backed
 *      leaves: all, events, flags, identify, session-replay, autocapture.
 *      Each dispatches through `skillCommandFactory` so the entry's
 *      `skillId` is what actually runs.
 *
 *   2. Wizard-native children that declare `parentCommand: 'audit'` on
 *      their `ProgramConfig` — currently just `web-analytics-doctor`. These
 *      live in the wizard (not in context-mill) because they do more than
 *      run a single skill.
 *
 * The parent `wizard audit` itself has no handler. Yargs auto-demands a
 * subcommand — Phase 5 replaces that with an interactive picker.
 */

// The comprehensive `wizard audit all` uses the specialized auditConfig
// (custom hooks, content blocks). The narrower audits (events, flags, etc.)
// use the generic agent-skill program — the manifest entry's skillId is what
// drives execution.
function resolveAuditConfig(skillId: string) {
  return skillId === 'audit' ? auditConfig : agentSkillConfig;
}

const auditSkillChildren = CLI_MANIFEST.entries
  .filter(
    (entry) => entry.surface === 'public' && entry.parentCommand === 'audit',
  )
  .map((entry) =>
    skillCommandFactory(entry, resolveAuditConfig(entry.skillId)),
  );

export const auditCommand: Command = {
  name: 'audit',
  description: auditConfig.description,
  children: [
    ...auditSkillChildren,
    nativeCommandFactory(webAnalyticsDoctorConfig),
  ],
};
