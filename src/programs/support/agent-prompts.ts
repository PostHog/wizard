import enableSupport from './agent/enable-support.md';
import identify from './agent/identify.md';
import init from './agent/init.md';
import install from './agent/install.md';
import report from './agent/report.md';
import setupSupport from './agent/setup-support.md';
import widget from './agent/widget.md';

/** This program's agent prompts by task type: each `agent/<type>.md`, imported as text. */
export const AGENT_PROMPTS: Readonly<Record<string, string>> = {
  'enable-support': enableSupport,
  identify,
  init,
  install,
  report,
  'setup-support': setupSupport,
  widget,
};
