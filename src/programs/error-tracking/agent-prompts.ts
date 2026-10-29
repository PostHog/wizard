import captureExceptions from './agent/capture-exceptions.md';
import configure from './agent/configure.md';
import credentials from './agent/credentials.md';
import init from './agent/init.md';
import install from './agent/install.md';
import linkReleases from './agent/link-releases.md';
import report from './agent/report.md';
import setupErrorTracking from './agent/setup-error-tracking.md';
import testSetup from './agent/test-setup.md';
import verify from './agent/verify.md';
import wireCi from './agent/wire-ci.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'capture-exceptions': captureExceptions,
  configure,
  credentials,
  init,
  install,
  'link-releases': linkReleases,
  report,
  'setup-error-tracking': setupErrorTracking,
  'test-setup': testSetup,
  verify,
  'wire-ci': wireCi,
};
