import type { Arguments } from 'yargs';

import type { Command } from '../../command';
import { auditCommand } from '../../audit';
import { createFamilyPickerDefault } from '../family-picker';

function makeArgv(extras: Record<string, unknown> = {}): Arguments {
  return { _: [], $0: 'wizard', ...extras } as Arguments;
}

describe('createFamilyPickerDefault', () => {
  it('dispatches the picked child handler with the original argv', async () => {
    const childHandler = jest.fn();
    const child: Command = {
      name: 'events',
      description: 'audit events',
      handler: childHandler,
    };
    const chooser = jest.fn().mockResolvedValue(child);

    const handler = createFamilyPickerDefault('wizard audit', [child], chooser);
    const argv = makeArgv({ debug: true });
    await handler(argv);

    expect(chooser).toHaveBeenCalledWith('wizard audit', [child]);
    expect(childHandler).toHaveBeenCalledWith(argv);
  });

  it('is a no-op when the user aborts the picker', async () => {
    const childHandler = jest.fn();
    const chooser = jest.fn().mockResolvedValue(null);

    const handler = createFamilyPickerDefault(
      'wizard audit',
      [
        {
          name: 'events',
          description: 'audit events',
          handler: childHandler,
        },
      ],
      chooser,
    );

    await handler(makeArgv());
    expect(childHandler).not.toHaveBeenCalled();
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
