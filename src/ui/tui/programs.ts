/**
 * Program sequences — declarative screen sequences for each wizard program.
 *
 * Owns the ScreenId and Program enums (re-exported by router.ts) to avoid
 * circular imports between router ↔ programs.
 *
 * Programs in PROGRAM_REGISTRY are derived via createProgramSequence().
 * MCP add/remove programs are standalone since they don't go through the
 * agent runner.
 */

import type { WizardSession } from '../../lib/wizard-session.js';
import {
  createProgramSequence,
  type ProgramStep,
} from '../../lib/programs/program-step.js';
import { PROGRAM_REGISTRY } from '../../lib/programs/program-registry.js';
import { AGENT_SKILL_STEPS } from '../../lib/programs/agent-skill/index.js';

// ── ScreenId + Program enums ──────────────────────────────────────────────

/** Screens that participate in linear programs */
export enum ScreenId {
  Intro = 'intro',
  RevenueIntro = 'revenue-intro',
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
  KeepSkills = 'keep-skills',
  Outro = 'outro',
  Exit = 'exit',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
}

/** Named programs the router can run */
export enum Program {
  PostHogIntegration = 'posthog-integration',
  RevenueAnalyticsSetup = 'revenue-analytics-setup',
  Migration = 'migration',
  Audit = 'audit',
  EventsAudit = 'events-audit',
  Audit3000 = 'audit-3000',
  PosthogDoctor = 'posthog-doctor',
  AgentSkill = 'agent-skill',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
}

// ── Program definitions ─────────────────────────────────────────────────

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

// ── Derived from PROGRAM_REGISTRY ───────────────────────────────────

/** Raw program step arrays — used by the store for gate/onInit definitions. */
export const PROGRAM_STEPS: Partial<Record<Program, ProgramStep[]>> = {
  ...(Object.fromEntries(
    PROGRAM_REGISTRY.map((c) => [c.id, c.steps]),
  ) as Partial<Record<Program, ProgramStep[]>>),
  [Program.AgentSkill]: AGENT_SKILL_STEPS,
};

/**
 * All program sequences.
 *
 * Programs in PROGRAM_REGISTRY are derived from the registry.
 * MCP add/remove programs are standalone.
 */
export const PROGRAM_SEQUENCES: Record<Program, Sequence> = {
  // Derive program sequences from registry
  ...(Object.fromEntries(
    PROGRAM_REGISTRY.map((c) => [
      c.id,
      createProgramSequence(c.steps) as Sequence,
    ]),
  ) as Record<Program, Sequence>),

  // Generic agent skill program
  [Program.AgentSkill]: createProgramSequence(AGENT_SKILL_STEPS) as Sequence,

  // Standalone MCP programs
  [Program.McpAdd]: [
    {
      id: ScreenId.McpAdd,
      isComplete: (s) => s.mcpComplete,
    },
    { id: ScreenId.Exit },
  ],

  [Program.McpRemove]: [
    {
      id: ScreenId.McpRemove,
      isComplete: (s) => s.mcpComplete,
    },
    { id: ScreenId.Exit },
  ],
};
