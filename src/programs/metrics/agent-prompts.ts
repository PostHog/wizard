import instrumentMetrics from './agent/instrument-metrics.md';
import report from './agent/report.md';
import setupMetrics from './agent/setup-metrics.md';
import verifySdk from './agent/verify-sdk.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'instrument-metrics': instrumentMetrics,
  report,
  'setup-metrics': setupMetrics,
  'verify-sdk': verifySdk,
};
