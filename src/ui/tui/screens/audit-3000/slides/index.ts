/**
 * Audit-3000 slide registry. Re-uses the original audit slides for the
 * shared areas (Installation, Identification, Event Capture) and adds
 * arcade-flavoured slides for the new areas the v3000 audit covers.
 *
 * Order matters: the index in this array is the "LEVEL N" number shown
 * on the run-screen left pane. Must match the ledger area order in
 * `lib/workflows/audit-3000/index.ts`.
 */

import type { AreaSlide } from '@ui/tui/screens/audit/slides/shared';
import { InstallationSlide } from '@ui/tui/screens/audit/slides/installation';
import { IdentificationSlide } from '@ui/tui/screens/audit/slides/identification';
import { EventCaptureSlide } from '@ui/tui/screens/audit/slides/eventCapture';
import { EventQualitySlide } from './eventQuality.js';
import { FeatureFlagsSlide } from './featureFlags.js';
import { SessionReplaySlide } from './sessionReplay.js';
import { SessionReplayOptimizeSlide } from './sessionReplayOptimize.js';
import { ExpansionSlide } from './expansion.js';
import { AdditionalSectionsSlide } from './additionalSections.js';

export type { AreaSlide };

export const AUDIT_3000_AREA_SLIDES: AreaSlide[] = [
  InstallationSlide, // L1
  IdentificationSlide, // L2
  EventCaptureSlide, // L3
  EventQualitySlide, // L4
  FeatureFlagsSlide, // L5
  SessionReplaySlide, // L6
  SessionReplayOptimizeSlide, // L7
  ExpansionSlide, // L8
  AdditionalSectionsSlide, // L9
];
