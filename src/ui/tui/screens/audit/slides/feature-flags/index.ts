/**
 * Slide registry for the feature-flags doctor program. Each entry is keyed
 * by `AuditCheck.area` and follows the doctor's ledger order: correctness →
 * cost → live delivery → observability → the consented fix phase.
 *
 * `AuditAreaPane` looks the active area up here when the active program is
 * the feature-flags doctor.
 */

import type { AreaSlide } from '../shared.js';
import { FlagCorrectnessSlide } from './correctness.js';
import { FlagOptimizeSlide } from './optimize.js';
import { FlagDeliverySlide } from './delivery.js';
import { FlagObservabilitySlide } from './observability.js';
import { FlagWorkflowSlide } from './workflow.js';

export const FEATURE_FLAGS_AREA_SLIDES: AreaSlide[] = [
  FlagCorrectnessSlide,
  FlagOptimizeSlide,
  FlagDeliverySlide,
  FlagObservabilitySlide,
  FlagWorkflowSlide,
];
