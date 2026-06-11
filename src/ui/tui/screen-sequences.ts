/**
 * Screen taxonomy + per-program screen sequences.
 *
 * Owns the ScreenId enum and projects each registered program's steps
 * into the router-shaped screen sequence (filtering headless steps and
 * appending the exit screen). Pure leaf module — no store, no React.
 */

import type { WizardSession } from '@lib/wizard-session';
import {
  PROGRAM_REGISTRY,
  type ProgramId,
} from '@lib/programs/program-registry';
import {
  createProgramSequence,
  type ProgramConfig,
  type ProgramStep,
} from '@lib/programs/program-step';

/** Screens that participate in linear programs. */
export enum ScreenId {
  Intro = 'intro',
  RevenueIntro = 'revenue-intro',
  SourceMapsIntro = 'source-maps-intro',
  SourceMapsOutro = 'source-maps-outro',
  MigrationIntro = 'migration-intro',
  AgentSkillIntro = 'agent-skill-intro',
  AuditIntro = 'audit-intro',
  AuditRun = 'audit-run',
  AuditOutro = 'audit-outro',
  Audit3000Intro = 'audit-3000-intro',
  Audit3000Run = 'audit-3000-run',
  Audit3000Outro = 'audit-3000-outro',
  HealthCheck = 'health-check',
  DoctorIntro = 'doctor-intro',
  DoctorReport = 'doctor-report',
  Setup = 'setup',
  Auth = 'auth',
  Run = 'run',
  Mcp = 'mcp',
  McpSuggestedPrompts = 'mcp-suggested-prompts',
  SlackConnect = 'slack-connect',
  KeepSkills = 'keep-skills',
  Outro = 'outro',
  Exit = 'exit',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
  AiOptIn = 'ai-opt-in',
}

export interface Screen {
  /** ScreenId to show */
  id: ScreenId;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (session: WizardSession) => boolean;
}

/** An ordered list of screens — a program's screen journey. */
export type Sequence = Screen[];

/**
 * Inject the AI opt-in gate step after `auth` for any program whose
 * agent run touches Anthropic Claude. `requiresAi: false` opts out; the
 * default is to gate. Programs without an `auth` step skip injection —
 * `apiUser` would never be populated for evaluation anyway.
 *
 * The gate predicate matches Max's strict reading: only literal `true`
 * proceeds; `null` / `undefined` / `false` all block.
 */
function withAiOptInGate(config: ProgramConfig): ProgramStep[] {
  if (config.requiresAi === false) return config.steps;

  const authIdx = config.steps.findIndex((s) => s.id === 'auth');
  if (authIdx === -1) return config.steps;

  const gateStep: ProgramStep = {
    id: 'ai-opt-in',
    label: 'AI opt-in check',
    screenId: ScreenId.AiOptIn,
    // Only fire once apiUser has actually been populated — between
    // setCredentials and setApiUser there's a brief emitChange window
    // where apiUser is null, and we don't want to flash the gate then.
    // Once apiUser is set, mirror Max's strict reading (only literal
    // `true` proceeds).
    show: (session) =>
      session.apiUser != null &&
      !session.apiUser.organization?.is_ai_data_processing_approved,
    isComplete: (session) =>
      !!session.apiUser?.organization?.is_ai_data_processing_approved,
  };

  return [
    ...config.steps.slice(0, authIdx + 1),
    gateStep,
    ...config.steps.slice(authIdx + 1),
  ];
}

/** All program screen sequences keyed by program id. */
export const PROGRAM_SEQUENCES: Record<ProgramId, Sequence> =
  Object.fromEntries(
    PROGRAM_REGISTRY.map((c) => [
      c.id,
      createProgramSequence(withAiOptInGate(c)) as Sequence,
    ]),
  ) as Record<ProgramId, Sequence>;
