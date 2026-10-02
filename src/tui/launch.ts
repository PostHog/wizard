/** What a host hands the TUI to start a run or a tool: plain data, so the TUI entry's declarations name no screen code. */
import type { CredentialsProvider, SessionArgs } from '@programs/types';
import type { WizardStore } from './store.js';
import type { TuiLaunchChoices } from './tui-state.js';

export type TuiLaunch = {
  session: SessionArgs & TuiLaunchChoices;
  skillId?: string; // `--skill` or `wizard skill <id>`; else the program's own
  taskStreamLog?: string; // --task-stream-log: a path, or '' for the default one
  runId?: string; // the cloud WizardRun this run reports under
  credentials?: CredentialsProvider; // the login for the run; the browser OAuth login when absent
  onStore?: (store: WizardStore) => void; // the in-process e2e host: the store once it exists
  signal: AbortSignal; // the CLI aborts it on SIGINT or SIGTERM, with the signal name as the reason
};

export type TuiToolLaunch = {
  session: SessionArgs & Pick<TuiLaunchChoices, 'mcpFeatures'>;
  signal: AbortSignal; // the CLI aborts it on SIGINT or SIGTERM, with the signal name as the reason
};
