/**
 * Audit-3000 slide registry. Re-uses the original audit slides for the
 * shared areas (Installation, Identification, Event Capture) and adds
 * arcade-flavoured slides for the three new areas the v3000 audit covers.
 */

import type { AreaSlide } from '../../audit/slides/shared.js';
import { InstallationSlide } from '../../audit/slides/installation.js';
import { IdentificationSlide } from '../../audit/slides/identification.js';
import { EventCaptureSlide } from '../../audit/slides/eventCapture.js';
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
