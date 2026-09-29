import { SESSION_SETTERS } from '../control';
import { SessionStore } from '../session-store';

/** Public members full control does not route, with why. */
const NOT_SETTERS: Record<string, string> = {
  constructor: 'not a member call',
  getFrameworkContext: 'read',
  subscribe: 'read: takes a listener function',
  getVersion: 'read',
  batch: 'takes a function',
  update: 'a raw patch; the named setters cover each field',
  edit: 'takes a function',
  setLogin:
    'a credentials provider records it; setCredentials and setApiUser cover it',
  reportWarehouseSources:
    'reporting, not state: the host runs it once consent is final',
  setAiSdkStampReported: 'a guard runProgram latches with the stamp',
  readyContext: "a view for a program's onReady",
  emit: 'private',
  set: 'private',
};

describe('sessionControlTarget', () => {
  it('routes every public session store method or names why it cannot', () => {
    const members = Object.getOwnPropertyNames(SessionStore.prototype).filter(
      (name) =>
        typeof Object.getOwnPropertyDescriptor(SessionStore.prototype, name)
          ?.value === 'function',
    );
    const routed = new Set(SESSION_SETTERS.map((s) => s.name));
    expect(
      members.filter((name) => !routed.has(name) && !(name in NOT_SETTERS)),
    ).toEqual([]);
    expect([...routed].filter((name) => !members.includes(name))).toEqual([]);
  });
});
