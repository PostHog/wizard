/**
 * Slide registry for `AuditAreaPane`. Each entry is a stand-alone module
 * keyed by `AuditCheck.area`. To add a new area, drop a `<area>.tsx` file
 * exporting an `AreaSlide` and append it here.
 */

import type { AreaSlide } from './shared.js';
import { InstallationSlide } from './installation.js';
import { IdentificationSlide } from './identification.js';
import { EventCaptureSlide } from './eventCapture.js';
import { LiveDataSlide } from './liveData.js';
import { WriteReportSlide } from './writeReport.js';
import { UploadNotebookSlide } from './uploadNotebook.js';

export type { AreaSlide };

export const AUDIT_AREA_SLIDES: AreaSlide[] = [
  InstallationSlide,
  IdentificationSlide,
  EventCaptureSlide,
  LiveDataSlide,
  WriteReportSlide,
  UploadNotebookSlide,
];

/**
 * Deck registry keyed by `session.skillId`. Programs on the audit-run
 * screen get the deck matching their skill; anything unlisted falls back
 * to the comprehensive-audit deck. To give a new audit program its own
 * deck, add a `<skill>/index.ts` deck module and one entry here.
 */
import { EVENTS_AUDIT_AREA_SLIDES } from './events-audit/index.js';
import { FEATURE_FLAGS_AREA_SLIDES } from './feature-flags/index.js';

const SLIDES_BY_SKILL: Record<string, AreaSlide[]> = {
  'audit-events': EVENTS_AUDIT_AREA_SLIDES,
  'events-audit': EVENTS_AUDIT_AREA_SLIDES,
  'audit-feature-flags': FEATURE_FLAGS_AREA_SLIDES,
};

export function getAreaSlides(skillId: string | null | undefined): AreaSlide[] {
  return (skillId && SLIDES_BY_SKILL[skillId]) || AUDIT_AREA_SLIDES;
}
