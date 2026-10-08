/**
 * The TUI program registry: each program's UI, gathered from its folder's
 * entry (`programs/<id>/index.ts`). A program without an entry runs the
 * generic skill program. Program logic stays on its `ProgramConfig`.
 *
 * The core reaches this module only through `getTuiProgram` and
 * `listTuiPrograms` (flows through `flowOwner`), and names no program; a
 * program folder never imports it. A tool's screens live in `../tools`.
 */

import type { TuiProgram, TuiPrograms } from './types.js';
import { SKILL_PROGRAM } from './shared/skill-program.js';
import { TUI_PROGRAMS as aiObservability } from '@tui/programs/ai-observability';
import { TUI_PROGRAMS as audit } from '@tui/programs/audit';
import { TUI_PROGRAMS as errorTracking } from '@tui/programs/error-tracking';
import { TUI_PROGRAMS as sourceMaps } from '@tui/programs/error-tracking-upload-source-maps';
import { TUI_PROGRAMS as featureFlags } from '@tui/programs/feature-flags';
import { TUI_PROGRAMS as metrics } from '@tui/programs/metrics';
import { TUI_PROGRAMS as migration } from '@tui/programs/migration';
import { TUI_PROGRAMS as posthogIntegration } from '@tui/programs/posthog-integration';
import { TUI_PROGRAMS as revenueAnalytics } from '@tui/programs/revenue-analytics';
import { TUI_PROGRAMS as selfDriving } from '@tui/programs/self-driving';
import { TUI_PROGRAMS as warehouseSource } from '@tui/programs/warehouse-source';

export type { TuiProgram };

const TUI_PROGRAMS: TuiPrograms = {
  ...aiObservability,
  ...audit,
  ...errorTracking,
  ...sourceMaps,
  ...featureFlags,
  ...metrics,
  ...migration,
  ...posthogIntegration,
  ...revenueAnalytics,
  ...selfDriving,
  ...warehouseSource,
};

export function getTuiProgram(programId: string): TuiProgram {
  return TUI_PROGRAMS[programId] ?? SKILL_PROGRAM;
}

/** Every TUI program, the generic skill program first. */
export function listTuiPrograms(): readonly TuiProgram[] {
  const programs = Object.values(TUI_PROGRAMS).filter(
    (p): p is TuiProgram => p !== undefined,
  );
  return [SKILL_PROGRAM, ...programs];
}
