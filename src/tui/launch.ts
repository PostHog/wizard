/** What a host hands the TUI to start a run or a tool: plain data, so the TUI entry's declarations name no screen code. */
import type { CredentialsProvider, SessionArgs } from '@programs/types';
import type { ControlLaunch } from '@host/control';
import type { ControlHooks, ControlTarget } from '@shared/control/types';
import type { TuiLaunchChoices } from './tui-state.js';

/** An in-process controller: it gets the store's control target and hooks once the store exists. */
export type TuiControlAttach = {
  attach: (target: ControlTarget, hooks: ControlHooks) => void;
};

export type TuiLaunch = {
  session: SessionArgs & TuiLaunchChoices;
  skillId?: string; // `--skill` or `wizard skill <id>`; else the program's own
  taskStreamLog?: string; // --task-stream-log: a path, or '' for the default one
  runId?: string; // the cloud WizardRun this run reports under
  credentials?: CredentialsProvider; // the login for the run and the control hook; the browser OAuth login when absent
  control?: ControlLaunch | TuiControlAttach; // serve the control API on a socket (dev builds), or hand it to an in-process controller
  signal: AbortSignal; // the CLI aborts it on SIGINT or SIGTERM, with the signal name as the reason
};

export type TuiToolLaunch = {
  session: SessionArgs & Pick<TuiLaunchChoices, 'mcpFeatures'>;
  signal: AbortSignal; // the CLI aborts it on SIGINT or SIGTERM, with the signal name as the reason
};
