import { Wizard, type WizardCommand } from '../wizard';

const cmd = (name: string | readonly string[]): WizardCommand => ({
  name,
  description: 'test',
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  handler: () => {},
});

describe('Wizard.use conflict detection', () => {
  test('throws on duplicate command name', () => {
    expect(() => Wizard.use(cmd('foo')).use(cmd('foo'))).toThrow(
      /already registered/,
    );
  });

  test('throws when a positional command collides with a plain one', () => {
    expect(() => Wizard.use(cmd('foo <bar>')).use(cmd('foo'))).toThrow(
      /already registered/,
    );
  });

  test('throws when an alias collides with another command', () => {
    expect(() => Wizard.use(cmd(['foo', 'f'])).use(cmd(['bar', 'f']))).toThrow(
      /already registered/,
    );
  });

  test('throws on duplicates passed to a single .use() call', () => {
    expect(() => Wizard.use(cmd('foo'), cmd('foo'))).toThrow(
      /already registered/,
    );
  });

  test('does not throw on distinct commands', () => {
    expect(() =>
      Wizard.use(cmd('foo'))
        .use(cmd('bar'))
        .use(cmd(['baz', 'b'])),
    ).not.toThrow();
  });

  test('throws on duplicate child under the same parent', () => {
    const parent: WizardCommand = {
      name: 'parent',
      description: 'p',
      children: [cmd('child'), cmd('child')],
    };
    expect(() => Wizard.use(parent)).toThrow(/parent child/);
  });

  test('allows the same child name under different parents', () => {
    expect(() =>
      Wizard.use({
        name: 'foo',
        description: 'f',
        children: [cmd('list')],
      }).use({
        name: 'bar',
        description: 'b',
        children: [cmd('list')],
      }),
    ).not.toThrow();
  });
});
