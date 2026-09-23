/** The run the agentic project scan hands to `runAgent`. */

import {
  Harness,
  HAIKU_MODEL,
  POSTHOG_DOCS_URL,
  Sequence,
} from '@shared/constants';
import type { AgentRunDefinition, ResolvedBinding } from '@agent/types';
import { detectNodePackageManagers } from './package-manager.js';

/** A fast mechanical scan: linear Haiku on the Anthropic harness. */
export const AGENTIC_DETECTION_BINDING: ResolvedBinding = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: HAIKU_MODEL,
};

/** No skill and no remark; the report is read back from the transcript tail. */
export function detectionRunDefinition(prompt: string): AgentRunDefinition {
  return {
    integrationLabel: 'agentic-detect',
    prompt: () => prompt,
    collectTranscript: true,
    requestRemark: false,
    detectPackageManager: detectNodePackageManagers,
    spinnerMessage: 'Scanning the repo...',
    successMessage: 'Detection complete',
    errorMessage: 'Detection failed',
    estimatedDurationMinutes: 1,
    reportFile: '',
    docsUrl: POSTHOG_DOCS_URL,
  };
}
