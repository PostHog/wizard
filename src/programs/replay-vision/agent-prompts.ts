import enableReplay from './agent/enable-replay.md';
import init from './agent/init.md';
import install from './agent/install.md';
import report from './agent/report.md';
import scannerFlowOutcome from './agent/scanner-flow-outcome.md';
import scannerProblems from './agent/scanner-problems.md';
import scannerSessionSummaries from './agent/scanner-session-summaries.md';
import setupReplayVision from './agent/setup-replay-vision.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'enable-replay': enableReplay,
  init,
  install,
  report,
  'scanner-flow-outcome': scannerFlowOutcome,
  'scanner-problems': scannerProblems,
  'scanner-session-summaries': scannerSessionSummaries,
  'setup-replay-vision': setupReplayVision,
};
