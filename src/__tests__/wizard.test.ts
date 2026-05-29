import { commandKeys, type Command } from '../commands/command';
import { basicIntegrationCommand } from '../commands/basic-integration';
import { mcpCommand } from '../commands/mcp';
import { integrateCommand } from '../commands/integrate';
import { auditCommand } from '../commands/audit';
import { audit3000Command } from '../commands/audit-3000';
import { doctorCommand } from '../commands/doctor';
import { migrateCommand } from '../commands/migrate';
import { eventsAuditCommand } from '../commands/events-audit';
import { revenueCommand } from '../commands/revenue';

const cmd = (name: string | readonly string[]): Command => ({
  name,
  description: 'test',
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {},
});

/**
 * Return every command path that is registered more than once across the tree.
 * The command tree is static, so this invariant is asserted here rather than
 * walked at runtime on every CLI invocation.
 */
function findConflicts(cmds: readonly Command[]): string[] {
  const seen = new Set<string>();
  const conflicts: string[] = [];
  const walk = (cmd: Command, parentPath: readonly string[]): void => {
    const keys = commandKeys(cmd.name);
    for (const key of keys) {
      const path = [...parentPath, key].join(' ');
      if (seen.has(path)) conflicts.push(path);
      else seen.add(path);
    }
    const ownPath = [...parentPath, keys[0]];
    for (const child of cmd.children ?? []) walk(child, ownPath);
  };
  for (const cmd of cmds) walk(cmd, []);
  return conflicts;
}

describe('findConflicts', () => {
  test('flags a duplicate command name', () => {
    expect(findConflicts([cmd('foo'), cmd('foo')])).toEqual(['foo']);
  });

  test('flags a positional command colliding with a plain one', () => {
    expect(findConflicts([cmd('foo <bar>'), cmd('foo')])).toEqual(['foo']);
  });

  test('flags an alias colliding with another command', () => {
    expect(findConflicts([cmd(['foo', 'f']), cmd(['bar', 'f'])])).toEqual([
      'f',
    ]);
  });

  test('flags a duplicate child under the same parent', () => {
    const parent: Command = {
      name: 'parent',
      description: 'p',
      children: [cmd('child'), cmd('child')],
    };
    expect(findConflicts([parent])).toEqual(['parent child']);
  });

  test('allows distinct commands', () => {
    expect(findConflicts([cmd('foo'), cmd('bar'), cmd(['baz', 'b'])])).toEqual(
      [],
    );
  });

  test('allows the same child name under different parents', () => {
    expect(
      findConflicts([
        { name: 'foo', description: 'f', children: [cmd('list')] },
        { name: 'bar', description: 'b', children: [cmd('list')] },
      ]),
    ).toEqual([]);
  });
});

describe('production command tree', () => {
  test('has no path conflicts', () => {
    const tree = [
      basicIntegrationCommand,
      mcpCommand,
      integrateCommand,
      auditCommand,
      audit3000Command,
      doctorCommand,
      migrateCommand,
      eventsAuditCommand,
      revenueCommand,
    ];
    // On failure, findConflicts returns the offending path(s) — i.e. which
    // command collides, not just that one did.
    expect(findConflicts(tree)).toEqual([]);
  });
});
