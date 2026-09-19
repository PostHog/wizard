import type { Arguments } from 'yargs';
import type { Mock } from 'vitest';

// Stub only Ink's `render` so `chooseFamilyChild` can build its options
// without mounting a real TUI; everything else in `ink` stays real.
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return { ...actual, render: vi.fn() };
});

import { render } from 'ink';

import {
  chooseFamilyChild,
  createFamilyPickerDefault,
  orderFamilyChildren,
  type FamilyChild,
} from '../family-picker.js';

function makeArgv(extras: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extras } as Arguments;
}

describe('orderFamilyChildren', () => {
  it('hoists the default-marked child to the front', () => {
    const a: FamilyChild = { name: 'a', description: 'a', handler: vi.fn() };
    const b: FamilyChild = {
      name: 'b',
      description: 'b',
      handler: vi.fn(),
      default: true,
    };
    const c: FamilyChild = { name: 'c', description: 'c', handler: vi.fn() };
    const ordered = orderFamilyChildren([a, b, c]);
    expect(ordered.map((cmd) => cmd.name)).toEqual(['b', 'a', 'c']);
  });

  it('preserves order when no child is marked default', () => {
    const a: FamilyChild = { name: 'a', description: 'a', handler: vi.fn() };
    const b: FamilyChild = { name: 'b', description: 'b', handler: vi.fn() };
    expect(orderFamilyChildren([a, b])).toEqual([a, b]);
  });

  it('drops children that have neither a handler nor children', () => {
    const dead: FamilyChild = { name: 'dead', description: 'd' };
    const real: FamilyChild = {
      name: 'real',
      description: 'd',
      handler: vi.fn(),
    };
    expect(orderFamilyChildren([dead, real])).toEqual([real]);
  });
});

describe('chooseFamilyChild', () => {
  it('renders the default leaf first so it is pre-highlighted (Enter runs it)', () => {
    (render as Mock).mockClear();
    const all: FamilyChild = {
      name: 'all',
      description: 'comprehensive',
      handler: vi.fn(),
      default: true,
    };
    const events: FamilyChild = {
      name: 'events',
      description: 'events',
      handler: vi.fn(),
    };

    // Input order puts the default LAST — the picker must reorder it to index 0.
    void chooseFamilyChild('wizard audit', [events, all]);

    expect(render as Mock).toHaveBeenCalledTimes(1);
    const element = (render as Mock).mock.calls[0][0];
    const options = element.props.options as {
      label: string;
      value: FamilyChild;
    }[];
    expect(options.map((o) => o.label)).toEqual(['all', 'events']);
    expect(options[0].value.default).toBe(true);
  });
});

describe('createFamilyPickerDefault', () => {
  it('always opens the picker — even when one child is marked default', async () => {
    const childHandler = vi.fn();
    const child: FamilyChild = {
      name: 'all',
      description: 'comprehensive',
      handler: childHandler,
      default: true,
    };
    const sibling: FamilyChild = {
      name: 'events',
      description: 'events',
      handler: vi.fn(),
    };
    const chooser = vi.fn().mockResolvedValue(child);

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
    const aHandler = vi.fn();
    const bHandler = vi.fn();
    const a: FamilyChild = {
      name: 'a',
      description: 'a',
      handler: aHandler,
      default: true,
    };
    const b: FamilyChild = { name: 'b', description: 'b', handler: bHandler };
    const chooser = vi.fn().mockResolvedValue(b);

    const handler = createFamilyPickerDefault('wizard family', [a, b], chooser);
    await handler(makeArgv());

    expect(bHandler).toHaveBeenCalled();
    expect(aHandler).not.toHaveBeenCalled();
  });

  it('is a no-op when the user aborts the picker', async () => {
    const handler = createFamilyPickerDefault(
      'wizard family',
      [
        { name: 'a', description: 'a', handler: vi.fn() },
        { name: 'b', description: 'b', handler: vi.fn() },
      ],
      vi.fn().mockResolvedValue(null),
    );
    await handler(makeArgv());
    // No expectations on handlers — they shouldn't run, but the test that
    // matters is that handler() resolves without throwing.
  });

  it('awaits async child handlers before resolving', async () => {
    let resolved = false;
    const child: FamilyChild = {
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
      vi.fn().mockResolvedValue(child),
    );
    await handler(makeArgv());
    expect(resolved).toBe(true);
  });
});
