import createFlag from './agent/create-flag.md';
import evaluate from './agent/evaluate.md';
import init from './agent/init.md';
import install from './agent/install.md';
import report from './agent/report.md';
import setupFeatureFlags from './agent/setup-feature-flags.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'create-flag': createFlag,
  evaluate,
  init,
  install,
  report,
  'setup-feature-flags': setupFeatureFlags,
};
