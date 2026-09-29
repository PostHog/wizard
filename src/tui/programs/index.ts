/**
 * The TUI program registry: each program's UI, gathered from its folder's
 * entry (`programs/<id>/index.ts`). A program without an entry runs the
 * generic skill program. Program logic stays on its `ProgramConfig`.
 *
 * The core reaches this module only through `getTuiProgram` and
 * `listTuiPrograms` (flows through `flowOwner`), and names no program; a
 * program folder never imports it. A tool's screens live in `../tools`.
 */

import type { FlowStep } from '../flow.js';
import type { TuiProgram, TuiPrograms } from './types.js';
import { SKILL_PROGRAM } from './shared/skill-program.js';
import { TUI_PROGRAMS as agentSkill } from '@tui/programs/agent-skill';
import { TUI_PROGRAMS as aiObservability } from '@tui/programs/ai-observability';
import { TUI_PROGRAMS as audit } from '@tui/programs/audit';
import { TUI_PROGRAMS as errorTracking } from '@tui/programs/error-tracking';
import { TUI_PROGRAMS as sourceMaps } from '@tui/programs/error-tracking-upload-source-maps';
import { TUI_PROGRAMS as metrics } from '@tui/programs/metrics';
import { TUI_PROGRAMS as migration } from '@tui/programs/migration';
import { TUI_PROGRAMS as posthogIntegration } from '@tui/programs/posthog-integration';
import { TUI_PROGRAMS as revenueAnalytics } from '@tui/programs/revenue-analytics';
import { TUI_PROGRAMS as selfDriving } from '@tui/programs/self-driving';
import { TUI_PROGRAMS as warehouseSource } from '@tui/programs/warehouse-source';
import { TUI_PROGRAMS as webAnalyticsDoctor } from '@tui/programs/web-analytics-doctor';

export type { TuiProgram };

const TUI_PROGRAMS: TuiPrograms = {
  ...agentSkill,
  ...aiObservability,
  ...audit,
  ...errorTracking,
  ...sourceMaps,
  ...metrics,
  ...migration,
  ...posthogIntegration,
  ...revenueAnalytics,
  ...selfDriving,
  ...warehouseSource,
  ...webAnalyticsDoctor,
};

export function getTuiProgram(programId: string): TuiProgram {
  return TUI_PROGRAMS[programId] ?? SKILL_PROGRAM;
}

/** The program's screen flow, for tests that walk a program's flow. */
export function getFlow(programId: string): FlowStep[] {
  return getTuiProgram(programId).flow;
}

/** Every TUI program, the generic skill program first. */
export function listTuiPrograms(): readonly TuiProgram[] {
  const programs = Object.values(TUI_PROGRAMS).filter(
    (p): p is TuiProgram => p !== undefined,
  );
  return [SKILL_PROGRAM, ...programs];
}

/** Every screen id a program mounts, for tests that walk all screens. */
export function programScreenIds(): string[] {
  return [
    ...new Set(listTuiPrograms().flatMap((p) => Object.keys(p.screens ?? {}))),
  ];
}
