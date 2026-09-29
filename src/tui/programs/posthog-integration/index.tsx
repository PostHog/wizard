/** The integration program's TUI: its flow, deck, intro and intro commit. */
import { ScanConsent } from '@shared/run-state';
import { optionalBoolean } from '@shared/control/params';
import type { ActionDef } from '@tui/control/defs';
import type { TuiPrograms } from '@tui/programs/types';
import { POSTHOG_INTEGRATION_FLOW } from './flow.js';
import { getContentBlocks } from './deck/index.js';
import { PostHogIntegrationScreenId } from './screen-ids.js';
import { PostHogIntegrationIntroScreen } from './screens/PostHogIntegrationIntroScreen.js';

export { PostHogIntegrationScreenId } from './screen-ids.js';

/** The intro also decides scan sharing; Enter grants when undecided, as its key handler does. */
const confirmSetupWithSharing: ActionDef = {
  id: 'confirm_setup',
  description:
    'Confirm the intro and continue. share: true grants and false declines ' +
    'sharing scan results; absent keeps the toggle (granted when undecided).',
  params: { share: 'boolean (optional)' },
  apply: (store, params) => {
    const share =
      params.share === undefined
        ? undefined
        : optionalBoolean('confirm_setup', params, 'share', true);
    if (share === false) {
      store.declineSharing();
    } else if (
      share === true ||
      store.session.scanConsent === ScanConsent.Undecided
    ) {
      store.grantSharing();
    }
    store.completeSetup();
  },
};

export const TUI_PROGRAMS: TuiPrograms = {
  'posthog-integration': {
    flow: POSTHOG_INTEGRATION_FLOW,
    deck: getContentBlocks,
    screens: {
      [PostHogIntegrationScreenId.Intro]: (store) => (
        <PostHogIntegrationIntroScreen store={store} />
      ),
    },
    actions: { [PostHogIntegrationScreenId.Intro]: [confirmSetupWithSharing] },
  },
};
