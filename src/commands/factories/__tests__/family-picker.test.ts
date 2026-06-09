import type { Arguments } from 'yargs';

import type { Command } from '../../command';
import { auditCommand } from '../../audit';
import { createFamilyPickerDefault, pickFamilyDefault } from '../family-picker';

function makeArgv(extras: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extras } as Arguments;
}

describe('pickFamilyDefault', () => {
  it('returns the single child when there is exactly one with a handler', () => {
    const child: Command = {
      name: 'only',
      description: 'd',
      handler: jest.fn(),
    };
    expect(pickFamilyDefault([child])).toBe(child);
  });

  it('returns the child marked `default: true` when multiple children exist', () => {
    const a: Command = { name: 'a', description: 'a', handler: jest.fn() };
    const b: Command = {
      name: 'b',
      description: 'b',
      handler: jest.fn(),
      default: true,
    };
    const c: Command = { name: 'c', description: 'c', handler: jest.fn() };
    expect(pickFamilyDefault([a, b, c])).toBe(b);
  });

  it('returns null when multiple children exist and none is marked default', () => {
    const a: Command = { name: 'a', description: 'a', handler: jest.fn() };
    const b: Command = { name: 'b', description: 'b', handler: jest.fn() };
    expect(pickFamilyDefault([a, b])).toBeNull();
  });

  it('ignores children without a handler when counting / picking', () => {
    const noHandler: Command = { name: 'menu', description: 'd', children: [] };
    const real: Command = { name: 'do', description: 'd', handler: jest.fn() };
    expect(pickFamilyDefault([noHandler, real])).toBe(real);
  });
});

describe('createFamilyPickerDefault', () => {
  it('auto-runs the single child without prompting the picker', async () => {
    const childHandler = jest.fn();
    const child: Command = {
      name: 'events',
      description: 'audit events',
      handler: childHandler,
    };
    const chooser = jest.fn();
    const handler = createFamilyPickerDefault('wizard audit', [child], chooser);
    const argv = makeArgv({ debug: true });
    await handler(argv);

    expect(chooser).not.toHaveBeenCalled();
    expect(childHandler).toHaveBeenCalledWith(argv);
  });

  it('auto-runs the default-marked child when multiple children exist', async () => {
    const aHandler = jest.fn();
    const bHandler = jest.fn();
    const a: Command = { name: 'a', description: 'a', handler: aHandler };
    const b: Command = {
      name: 'b',
      description: 'b',
      handler: bHandler,
      default: true,
    };
    const chooser = jest.fn();
    const handler = createFamilyPickerDefault('wizard family', [a, b], chooser);

    await handler(makeArgv());
    expect(chooser).not.toHaveBeenCalled();
    expect(aHandler).not.toHaveBeenCalled();
    expect(bHandler).toHaveBeenCalled();
  });

  it('opens the picker when there is no default and no single child', async () => {
    const aHandler = jest.fn();
    const bHandler = jest.fn();
    const a: Command = { name: 'a', description: 'a', handler: aHandler };
    const b: Command = { name: 'b', description: 'b', handler: bHandler };
    const chooser = jest.fn().mockResolvedValue(b);

    const handler = createFamilyPickerDefault('wizard family', [a, b], chooser);
    await handler(makeArgv());

    expect(chooser).toHaveBeenCalledWith('wizard family', [a, b]);
    expect(bHandler).toHaveBeenCalled();
    expect(aHandler).not.toHaveBeenCalled();
  });

  it('is a no-op when the user aborts the picker', async () => {
    const aHandler = jest.fn();
    const bHandler = jest.fn();
    const chooser = jest.fn().mockResolvedValue(null);
    const handler = createFamilyPickerDefault(
      'wizard family',
      [
        { name: 'a', description: 'a', handler: aHandler },
        { name: 'b', description: 'b', handler: bHandler },
      ],
      chooser,
    );
    await handler(makeArgv());
    expect(aHandler).not.toHaveBeenCalled();
    expect(bHandler).not.toHaveBeenCalled();
  });

  it('awaits async child handlers before resolving', async () => {
    let resolved = false;
    const child: Command = {
      name: 'events',
      description: 'audit events',
      handler: () =>
        new Promise<void>(
          (resolve) =>
            setTimeout(() => {
              resolved = true;
              resolve();
            }, 5),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any,
    };
    const handler = createFamilyPickerDefault(
      'wizard audit',
      [child],
      jest.fn(),
    );
    await handler(makeArgv());
    expect(resolved).toBe(true);
  });
});

describe('auditCommand', () => {
  it('wires interactiveDefault for the bare `wizard audit` invocation', () => {
    expect(typeof auditCommand.interactiveDefault).toBe('function');
  });

  it('still exposes children so yargs can route `wizard audit <leaf>`', () => {
    expect(auditCommand.children?.length).toBeGreaterThan(0);
  });
});
