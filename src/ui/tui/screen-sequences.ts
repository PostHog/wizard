/**
 * Screen taxonomy + per-program screen sequences.
 *
 * Owns the ScreenId enum and projects each registered program's steps
 * into the router-shaped screen sequence (filtering headless steps and
 * appending the exit screen). Pure leaf module — no store, no React.
 */

import type { WizardSession } from '@lib/wizard-session';
import { PROGRAM_REGISTRY, type ProgramId } from '@programs';
import { createProgramSequence } from '@programs/program-step';
import { withAiOptInGate } from '@programs/ai-opt-in-gate';

/** Screens that participate in linear programs. */
export enum ScreenId {
  Intro = 'intro',
  RevenueIntro = 'revenue-intro',
  WarehouseIntro = 'warehouse-intro',
  SourceMapsIntro = 'source-maps-intro',
  SourceMapsDetect = 'source-maps-detect',
  SourceMapsOutro = 'source-maps-outro',
  MigrationIntro = 'migration-intro',
  AgentSkillIntro = 'agent-skill-intro',
  AiObservabilityIntro = 'ai-observability-intro',
  MetricsIntro = 'metrics-intro',
  ErrorTrackingIntro = 'error-tracking-intro',
  ErrorTrackingDetect = 'error-tracking-detect',
  SelfDrivingIntro = 'self-driving-intro',
  SelfDrivingIntegrationCheck = 'self-driving-integration-check',
  SelfDrivingIntegrationDetect = 'self-driving-integration-detect',
  SelfDrivingHandoff = 'self-driving-handoff',
  SelfDrivingGithub = 'self-driving-github',
  AuditIntro = 'audit-intro',
  AuditRun = 'audit-run',
  AuditOutro = 'audit-outro',
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
  MintFailure = 'mint-failure',
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

/** Post-run steps a mint-failure handoff continues through; ends on exit. */
export const MINT_HANDOFF_SEQUENCE: Sequence = [
  { id: ScreenId.Mcp, isComplete: (s) => s.mcpComplete },
  { id: ScreenId.SlackConnect, isComplete: (s) => s.slackStepDismissed },
  { id: ScreenId.KeepSkills, isComplete: (s) => s.skillsComplete },
  { id: ScreenId.Exit },
];

/** All program screen sequences keyed by program id. */
export const PROGRAM_SEQUENCES: Record<ProgramId, Sequence> =
  Object.fromEntries(
    PROGRAM_REGISTRY.map((c) => [
      c.id,
      createProgramSequence(withAiOptInGate(c)) as Sequence,
    ]),
  ) as Record<ProgramId, Sequence>;
