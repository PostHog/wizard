/** The audit programs' TUI: the audit family and the events audit share one set of screens. */
import type { TuiProgram, TuiPrograms } from '@tui/programs/types';
import { getContentBlocks as skillDeck } from '@tui/programs/shared/skill-deck';
import { AUDIT_FLOW } from './flow.js';
import { EVENTS_AUDIT_FLOW } from './events-flow.js';
import { AuditScreenId } from './screen-ids.js';
import { AuditIntroScreen } from './screens/AuditIntroScreen.js';
import { AuditRunScreen } from './screens/AuditRunScreen.js';
import { AuditOutroScreen } from './screens/AuditOutroScreen.js';

export { AuditScreenId } from './screen-ids.js';

const screens: TuiProgram['screens'] = {
  [AuditScreenId.Intro]: (store) => <AuditIntroScreen store={store} />,
  [AuditScreenId.Run]: (store) => <AuditRunScreen store={store} />,
  [AuditScreenId.Outro]: (store) => <AuditOutroScreen store={store} />,
};

export const TUI_PROGRAMS: TuiPrograms = {
  audit: { flow: AUDIT_FLOW, deck: skillDeck, screens },
  'events-audit': { flow: EVENTS_AUDIT_FLOW, screens },
};
