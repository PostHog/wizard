/**
 * Standalone full-terminal preview for AiOptInRequiredScreen.
 *
 * Renders the screen with a synthetic store at full terminal height — no
 * TabContainer chrome, no playground header. Use this when you want to
 * see exactly what the screen will look like to a real user.
 *
 * Usage:
 *   pnpm preview:ai-opt-in admin
 *   pnpm preview:ai-opt-in non-admin
 *
 * Default variant is 'admin' if no arg is passed. Press Ctrl-C to exit
 * (keybindings on the screen are LIVE — [E] also exits via process.exit,
 * [O] opens a real browser tab, [R] fires a network request that will
 * fail with the fake token).
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore } from '../src/ui/tui/store';
import { AiOptInRequiredScreen } from '../src/ui/tui/screens/AiOptInRequiredScreen';

const variantArg = process.argv[2] ?? 'admin';
if (variantArg !== 'admin' && variantArg !== 'non-admin') {
  // eslint-disable-next-line no-console
  console.error(`Unknown variant "${variantArg}". Use "admin" or "non-admin".`);
  process.exit(1);
}
const isAdmin = variantArg === 'admin';

const store = new WizardStore();
store.setCredentials({
  accessToken: 'preview-fake-token',
  projectApiKey: 'preview-fake-project-key',
  host: 'https://us.posthog.com',
  projectId: 0,
});
store.session.region = 'us';
store.setApiUser({
  distinct_id: 'preview-distinct-id',
  email: 'sarah@example.com',
  organization: {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Preview Org',
    membership_level: isAdmin ? 8 : 1,
    is_ai_data_processing_approved: false,
  } as never,
  organizations: [],
  team: {
    id: 0,
    organization: '00000000-0000-0000-0000-000000000000',
  } as never,
} as never);

const { waitUntilExit } = render(
  createElement(AiOptInRequiredScreen, { store }),
);

void waitUntilExit().then(() => process.exit(0));
