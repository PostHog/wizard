import aiObservability from './agent/ai-observability.md';
import capture from './agent/capture.md';
import dashboard from './agent/dashboard.md';
import errorTracking from './agent/error-tracking.md';
import identify from './agent/identify.md';
import init from './agent/init.md';
import install from './agent/install.md';
import integratePosthog from './agent/integrate-posthog.md';
import logs from './agent/logs.md';
import report from './agent/report.md';
import review from './agent/review.md';
import warehouse from './agent/warehouse.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'ai-observability': aiObservability,
  capture,
  dashboard,
  'error-tracking': errorTracking,
  identify,
  init,
  install,
  'integrate-posthog': integratePosthog,
  logs,
  report,
  review,
  warehouse,
};
