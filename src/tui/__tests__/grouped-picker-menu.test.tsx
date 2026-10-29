/** GroupedPickerMenu's scroll rows say how to reveal hidden options, and its count names what it counts. */
import { vi, describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { GroupedPickerMenu } from '../primitives/GroupedPickerMenu';
import { ConfirmButton } from '../primitives/ConfirmButton';

vi.mock(import('ink'), () =>
  vi.importActual<typeof import('ink')>('ink-actual'),
);

afterEach(() => cleanup());

const UP = '\u001B[A';
const DOWN = '\u001B[B';
const SPACE = ' ';
// A prompt's frame renders before its input handler attaches in a passive
// effect, so a key written on the same turn as the frame can be dropped.
const tick = () => new Promise((r) => setTimeout(r, 20));

const option = (group: string, i: number) => ({
  value: `${group}-${i}`,
  label: `${group} option ${i}`,
});
const LONG_GROUPS = {
  Analytics: Array.from({ length: 8 }, (_, i) => option('analytics', i)),
  Replay: Array.from({ length: 8 }, (_, i) => option('replay', i)),
};
const SHORT_GROUPS = { Analytics: [option('analytics', 0)] };
const AREAS = { one: 'area', other: 'areas' };

const count = (frame: string, text: string) => frame.split(text).length - 1;

describe('GroupedPickerMenu scroll rows', () => {
  it('names the hidden options below and the keys that reveal them, once', () => {
    const frame =
      render(
        <GroupedPickerMenu groups={LONG_GROUPS} onSelect={() => undefined} />,
      ).lastFrame() ?? '';
    expect(frame).toMatch(/↓ \d+ more below · ↑↓ to scroll/);
    expect(frame).not.toContain('more above');
    expect(count(frame, '↑↓ to scroll')).toBe(1);
  });

  it('moves the hint to the top row once nothing is hidden below', async () => {
    const { stdin, lastFrame } = render(
      <GroupedPickerMenu groups={LONG_GROUPS} onSelect={() => undefined} />,
    );
    await tick();
    // Up from the first option lands on Confirm; up again wraps to the last option.
    stdin.write(UP);
    await tick();
    stdin.write(UP);
    await vi.waitFor(() => expect(lastFrame()).toContain('more above'));
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/↑ \d+ more above · ↑↓ to scroll/);
    expect(frame).not.toContain('more below');
    expect(count(frame, '↑↓ to scroll')).toBe(1);
  });

  it('keeps space toggling the focused option, not expanding the list', async () => {
    const { stdin, lastFrame } = render(
      <GroupedPickerMenu
        groups={LONG_GROUPS}
        initialSelected={[]}
        countNoun={AREAS}
        onSelect={() => undefined}
      />,
    );
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(SPACE);
    await vi.waitFor(() => expect(lastFrame()).toContain('Confirm (1 area)'));
    expect(lastFrame()).toMatch(/↓ \d+ more below/);
  });

  it('renders no scroll rows when every option fits', () => {
    const frame =
      render(
        <GroupedPickerMenu groups={SHORT_GROUPS} onSelect={() => undefined} />,
      ).lastFrame() ?? '';
    expect(frame).not.toContain('more');
    expect(frame).not.toContain('to scroll');
  });
});

describe('ConfirmButton count', () => {
  const frameOf = (props: Parameters<typeof ConfirmButton>[0]) =>
    render(<ConfirmButton {...props} />).lastFrame() ?? '';

  it('names what it counts, singular and plural', () => {
    expect(frameOf({ focused: true, count: 1, countNoun: AREAS })).toContain(
      'Confirm (1 area)',
    );
    expect(frameOf({ focused: true, count: 16, countNoun: AREAS })).toContain(
      'Confirm (16 areas)',
    );
  });

  it('keeps the bare count without a noun, and no count at zero', () => {
    expect(frameOf({ focused: true, count: 3 })).toContain('Confirm (3)');
    const empty = frameOf({ focused: true, count: 0, countNoun: AREAS });
    expect(empty).toContain('Confirm');
    expect(empty).not.toContain('(');
  });
});
