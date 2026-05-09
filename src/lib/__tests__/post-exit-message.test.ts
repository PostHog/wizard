import { buildSession } from '../wizard-session';
import {
  POST_EXIT_MESSAGE_KEY,
  getPostExitMessage,
  setPostExitMessage,
} from '../post-exit-message';

describe('post-exit-message accessors', () => {
  it('round-trips set + get on the same session', () => {
    const session = buildSession({});
    setPostExitMessage(session, 'hello terminal scrollback');
    expect(getPostExitMessage(session)).toBe('hello terminal scrollback');
  });

  it('returns undefined when nothing has been stashed', () => {
    expect(getPostExitMessage(buildSession({}))).toBeUndefined();
  });

  it('returns undefined when frameworkContext holds a non-string at the key', () => {
    // Defense-in-depth: the type guard rejects bogus shapes rather than
    // returning garbage to the cleanup printer.
    const session = buildSession({});
    session.frameworkContext[POST_EXIT_MESSAGE_KEY] = { not: 'a string' };
    expect(getPostExitMessage(session)).toBeUndefined();
  });

  it('survives shallow setKey clones of the top-level session', () => {
    // The whole point of using frameworkContext: agent-runner.ts mutates
    // session.outroData on a stale reference (the atom replaces session
    // via setKey during the run), and the mutation goes to a stranded
    // object. frameworkContext is shared by reference across those
    // setKey shallow-spreads, so a direct mutation on it survives a
    // top-level replacement of the session — which is exactly what
    // happens in production. Simulate that here.
    const original = buildSession({});
    setPostExitMessage(original, 'lives in shared framework context');

    // Simulate setKey: a NEW top-level session object that shallow-copies
    // each top-level key from the original (so frameworkContext is the
    // SAME reference as before).
    const replaced = { ...original, lastStatus: 'something changed' };
    expect(getPostExitMessage(replaced)).toBe(
      'lives in shared framework context',
    );
  });
});
