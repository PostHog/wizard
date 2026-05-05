/**
 * Slide registry for `AuditAreaPane`. Each entry is a stand-alone module
 * keyed by `AuditCheck.area`. To add a new area, drop a `<area>.tsx` file
 * exporting an `AreaSlide` and append it here.
 */

import type { AreaSlide } from './shared.js';
import { InstallationSlide } from './installation.js';
import { IdentificationSlide } from './identification.js';
import { EventCaptureSlide } from './eventCapture.js';

export type { AreaSlide };

export const AUDIT_AREA_SLIDES: AreaSlide[] = [
  InstallationSlide,
  IdentificationSlide,
  EventCaptureSlide,
];
