import enableReplay from './agent/enable-replay.md';
import init from './agent/init.md';
import install from './agent/install.md';
import report from './agent/report.md';
import scannerBrokenExperiences from './agent/scanner-broken-experiences.md';
import scannerSessionSummaries from './agent/scanner-session-summaries.md';
import scannerUserFrustration from './agent/scanner-user-frustration.md';
import setupReplayVision from './agent/setup-replay-vision.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'enable-replay': enableReplay,
  init,
  install,
  report,
  'scanner-broken-experiences': scannerBrokenExperiences,
  'scanner-session-summaries': scannerSessionSummaries,
  'scanner-user-frustration': scannerUserFrustration,
  'setup-replay-vision': setupReplayVision,
};
