import { TRANSACTIONAL_EMAIL_ABORT_CASES } from '@programs/transactional-email';

describe('TRANSACTIONAL_EMAIL_ABORT_CASES', () => {
  // The exact `[ABORT] <reason>` strings of the send-transactional-email skill's
  // "Inside the PostHog Wizard" section (context-mill), prefix stripped.
  it.each(['transactional email api not enabled', 'no server code found'])(
    'matches the "%s" abort reason exactly once',
    (reason) => {
      const matched = TRANSACTIONAL_EMAIL_ABORT_CASES.filter((c) =>
        c.match.test(reason),
      );
      expect(matched).toHaveLength(1);
    },
  );
});
