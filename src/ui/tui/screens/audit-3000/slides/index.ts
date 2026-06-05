/**
 * Audit-3000 slide registry. Re-uses the original audit slides for the
 * shared areas (Installation, Identification, Event Capture) and adds
 * arcade-flavoured slides for the three new areas the v3000 audit covers.
 */

import type { AreaSlide } from '@ui/tui/screens/audit/slides/shared';
import { InstallationSlide } from '@ui/tui/screens/audit/slides/installation';
import { IdentificationSlide } from '@ui/tui/screens/audit/slides/identification';
import { EventCaptureSlide } from '@ui/tui/screens/audit/slides/eventCapture';
import { EventQualitySlide } from './eventQuality.js';
import { FeatureFlagsSlide } from './featureFlags.js';
import { ExpansionSlide } from './expansion.js';

export type { AreaSlide };

export const AUDIT_3000_AREA_SLIDES: AreaSlide[] = [
  InstallationSlide,
  IdentificationSlide,
  EventCaptureSlide,
  EventQualitySlide,
  FeatureFlagsSlide,
  ExpansionSlide,
];
