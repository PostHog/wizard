import { auditCommand } from '../../audit.js';

describe('auditCommand', () => {
  it('wires interactiveDefault for the bare `wizard audit` invocation', () => {
    expect(typeof auditCommand.interactiveDefault).toBe('function');
  });

  it('routes leaves through a runtime handler (no static yargs children)', () => {
    // Skill-backed audit leaves resolve via `dispatchFamily` at runtime
    // against `cliEntries` in `skill-menu.json`, not via baked yargs
    // children. So `auditCommand.children` is intentionally empty; the
    // `[skill]` positional + handler is the routing surface.
    expect(auditCommand.children).toBeUndefined();
    expect(typeof auditCommand.handler).toBe('function');
  });
});
