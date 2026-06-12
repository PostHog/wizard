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
import { createProgramSequence } from '@lib/programs/program-step';

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

/** All program screen sequences keyed by program id. */
export const PROGRAM_SEQUENCES: Record<ProgramId, Sequence> =
  Object.fromEntries(
    PROGRAM_REGISTRY.map((c) => [
      c.id,
      createProgramSequence(c.steps) as Sequence,
    ]),
  ) as Record<ProgramId, Sequence>;
