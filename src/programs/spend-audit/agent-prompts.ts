import applyCodeFixes from './agent/apply-code-fixes.md';
import auditErrors from './agent/audit-errors.md';
import auditEvents from './agent/audit-events.md';
import auditFlags from './agent/audit-flags.md';
import auditGroups from './agent/audit-groups.md';
import auditIdentify from './agent/audit-identify.md';
import auditReplay from './agent/audit-replay.md';
import measureVolumes from './agent/measure-volumes.md';
import planSpendAudit from './agent/plan-spend-audit.md';
import report from './agent/report.md';
import valueInsights from './agent/value-insights.md';

/** This program's agent prompts by task type, imported as text: the planner, then the tasks in the order it queues them. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'plan-spend-audit': planSpendAudit,
  'measure-volumes': measureVolumes,
  'audit-identify': auditIdentify,
  'audit-groups': auditGroups,
  'audit-events': auditEvents,
  'audit-flags': auditFlags,
  'audit-errors': auditErrors,
  'audit-replay': auditReplay,
  'apply-code-fixes': applyCodeFixes,
  'value-insights': valueInsights,
  report,
};
