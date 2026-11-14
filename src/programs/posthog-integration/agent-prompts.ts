import aiObservability from './agent/ai-observability.md';
import capture from './agent/capture.md';
import dashboard from './agent/dashboard.md';
import errorTracking from './agent/error-tracking.md';
import identify from './agent/identify.md';
import init from './agent/init.md';
import install from './agent/install.md';
import logs from './agent/logs.md';
import mcpAnalytics from './agent/mcp-analytics.md';
import report from './agent/report.md';
import review from './agent/review.md';
import warehouse from './agent/warehouse.md';

/** This program's agent prompts by task type, imported as text, in the order tasks that can start together are queued. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  install,
  init,
  identify,
  'error-tracking': errorTracking,
  'mcp-analytics': mcpAnalytics,
  capture,
  'ai-observability': aiObservability,
  logs,
  review,
  dashboard,
  report,
  warehouse,
};
