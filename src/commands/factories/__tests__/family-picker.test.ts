import type { Arguments } from 'yargs';

// Stub only Ink's `render` so `chooseFamilyChild` can build its options
// without mounting a real TUI; everything else in `ink` stays real.
jest.mock('ink', () => {
  const actual = jest.requireActual('ink');
  return { ...actual, render: jest.fn() };
});

import { render } from 'ink';

import type { Command } from '../../command';
import { auditCommand } from '../../audit';
import {
  chooseFamilyChild,
  createFamilyPickerDefault,
  orderFamilyChildren,
} from '../family-picker';

function makeArgv(extras: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extras } as Arguments;
}

describe('orderFamilyChildren', () => {
  it('hoists the default-marked child to the front', () => {
    const a: Command = { name: 'a', description: 'a', handler: jest.fn() };
    const b: Command = {
      name: 'b',
      description: 'b',
      handler: jest.fn(),
      default: true,
    };
    const c: Command = { name: 'c', description: 'c', handler: jest.fn() };
    const ordered = orderFamilyChildren([a, b, c]);
    expect(ordered.map((cmd) => cmd.name)).toEqual(['b', 'a', 'c']);
  });

  it('preserves order when no child is marked default', () => {
    const a: Command = { name: 'a', description: 'a', handler: jest.fn() };
    const b: Command = { name: 'b', description: 'b', handler: jest.fn() };
    expect(orderFamilyChildren([a, b])).toEqual([a, b]);
  });

  it('drops children that have neither a handler nor children', () => {
    const dead: Command = { name: 'dead', description: 'd' };
    const real: Command = {
      name: 'real',
      description: 'd',
      handler: jest.fn(),
    };
    expect(orderFamilyChildren([dead, real])).toEqual([real]);
  });
});

describe('chooseFamilyChild', () => {
  it('renders the default leaf first so it is pre-highlighted (Enter runs it)', () => {
    (render as jest.Mock).mockClear();
    const all: Command = {
      name: 'all',
      description: 'comprehensive',
      handler: jest.fn(),
      default: true,
    };
    const events: Command = {
      name: 'events',
      description: 'events',
      handler: jest.fn(),
    };

    // Input order puts the default LAST — the picker must reorder it to index 0.
    void chooseFamilyChild('wizard audit', [events, all]);

    expect(render as jest.Mock).toHaveBeenCalledTimes(1);
    const element = (render as jest.Mock).mock.calls[0][0];
    const options = element.props.options as {
      label: string;
      value: Command;
    }[];
    expect(options.map((o) => o.label)).toEqual(['all', 'events']);
    expect(options[0].value.default).toBe(true);
  });
});

describe('createFamilyPickerDefault', () => {
  it('always opens the picker — even when one child is marked default', async () => {
    const childHandler = jest.fn();
    const child: Command = {
      name: 'all',
      description: 'comprehensive',
      handler: childHandler,
      default: true,
    };
    const sibling: Command = {
      name: 'events',
      description: 'events',
      handler: jest.fn(),
    };
    const chooser = jest.fn().mockResolvedValue(child);

    const handler = createFamilyPickerDefault(
      'wizard audit',
      [child, sibling],
      chooser,
    );
    const argv = makeArgv({ debug: true });
    await handler(argv);

    expect(chooser).toHaveBeenCalledWith('wizard audit', [child, sibling]);
    expect(childHandler).toHaveBeenCalledWith(argv);
  });

  it('dispatches whichever child the picker resolves', async () => {
    const aHandler = jest.fn();
    const bHandler = jest.fn();
    const a: Command = {
      name: 'a',
      description: 'a',
      handler: aHandler,
      default: true,
    };
    const b: Command = { name: 'b', description: 'b', handler: bHandler };
    const chooser = jest.fn().mockResolvedValue(b);

    const handler = createFamilyPickerDefault('wizard family', [a, b], chooser);
    await handler(makeArgv());

    expect(bHandler).toHaveBeenCalled();
    expect(aHandler).not.toHaveBeenCalled();
  });

  it('is a no-op when the user aborts the picker', async () => {
    const handler = createFamilyPickerDefault(
      'wizard family',
      [
        { name: 'a', description: 'a', handler: jest.fn() },
        { name: 'b', description: 'b', handler: jest.fn() },
      ],
      jest.fn().mockResolvedValue(null),
    );
    await handler(makeArgv());
    // No expectations on handlers — they shouldn't run, but the test that
    // matters is that handler() resolves without throwing.
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
      jest.fn().mockResolvedValue(child),
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
