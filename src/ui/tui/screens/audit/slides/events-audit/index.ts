/**
 * Slide registry for the events-audit program. Each entry is keyed by
 * `AuditCheck.area` and corresponds to one phase of the 6-phase pipeline.
 *
 * `AuditAreaPane` looks up the active phase's slide here when the active
 * program is events-audit.
 */

import type { AreaSlide } from '../shared.js';
import { DetectSdkSlide } from './detectSdk.js';
import { ScanSitesSlide } from './scanSites.js';
import { EnrichSitesSlide } from './enrichSites.js';
import { QueryVolumeSlide } from './queryVolume.js';
import { WriteReportSlide } from './writeReport.js';
import { CreateDashboardSlide } from './createDashboard.js';

export const EVENTS_AUDIT_AREA_SLIDES: AreaSlide[] = [
  DetectSdkSlide,
  ScanSitesSlide,
  EnrichSitesSlide,
  QueryVolumeSlide,
  WriteReportSlide,
  CreateDashboardSlide,
];
