/** The doctor TUI: its flow, its screens, and the login its report waits on. */
import type { TuiTools } from '@tui/tools/types';
import { POSTHOG_DOCTOR_FLOW } from './flow.js';
import { PosthogDoctorScreenId } from './screen-ids.js';
import { DoctorIntroScreen } from './screens/DoctorIntroScreen.js';
import { DoctorReportScreen } from './screens/DoctorReportScreen.js';

export { PosthogDoctorScreenId } from './screen-ids.js';

export const TUI_TOOLS: TuiTools = {
  'posthog-doctor': {
    flow: POSTHOG_DOCTOR_FLOW,
    screens: {
      [PosthogDoctorScreenId.Intro]: (store) => (
        <DoctorIntroScreen store={store} />
      ),
      [PosthogDoctorScreenId.Report]: (store) => (
        <DoctorReportScreen store={store} />
      ),
    },
    // The report fetch advances it.
    actions: { [PosthogDoctorScreenId.Report]: [] },
    // The auth screen shows the login once the intro and the health check pass.
    start: async ({ store, logIn }) => {
      await store.getGate('intro');
      await store.getGate('health-check');
      await logIn();
    },
  },
};
