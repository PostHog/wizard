/**
 * Replay a {@link Recording} in the terminal: for each recorded frame,
 * reconstruct a throwaway store from the frame's state and render the REAL Ink
 * screen back to ANSI — so an agent or a human sees the run play back exactly as
 * the live TUI drew it, paused at each key moment.
 *
 * Rendering is offline against a disposable store, so screen effects (detection,
 * prefetch) fire harmlessly against the recorded state and never touch the real
 * run.
 */

import { readFileSync } from 'fs';
import type { ReactElement } from 'react';
import { render } from 'ink-testing-library';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { TaskStatus } from '@ui/wizard-ui';
import type { ProgramId } from '@ui/tui/router';
import { createScreens, createServices } from '@ui/tui/screen-registry';
import type { Recording, RecordedFrame } from './recorder.js';

export function loadRecording(path: string): Recording {
  return JSON.parse(readFileSync(path, 'utf8')) as Recording;
}

/**
 * Render one frame's screen to an ANSI string by rebuilding a disposable store
 * from the frame and mounting the real screen component. Falls back to a text
 * summary if a screen throws on render.
 */
export function renderFrame(frame: RecordedFrame, program: ProgramId): string {
  const store = new WizardStore(program);
  setUI(new InkUI(store));
  store.session = frame.session;
  store.setTasks(
    frame.tasks.map((t) => ({
      label: t.label,
      activeForm: t.activeForm,
      status: (t.status as TaskStatus) ?? TaskStatus.Pending,
      done: t.done,
    })),
  );
  if (frame.eventPlan.length > 0) store.setEventPlan(frame.eventPlan);
  for (const m of frame.statusMessages) store.pushStatus(m);

  try {
    const services = createServices(store);
    const screens = createScreens(store, services);
    const node = screens[frame.screen];
    if (!node) return `(no component registered for screen "${frame.screen}")`;
    const { lastFrame, unmount } = render(node as ReactElement);
    const out = lastFrame() ?? '';
    unmount();
    return out;
  } catch (err) {
    return `(render failed: ${
      err instanceof Error ? err.message : String(err)
    })`;
  }
}

/** One-line header summarizing a frame. */
export function frameHeader(frame: RecordedFrame, total: number): string {
  const secs = (frame.ms / 1000).toFixed(1);
  const tasks = frame.tasks.length
    ? ` · tasks ${frame.tasks.filter((t) => t.done).length}/${
        frame.tasks.length
      }`
    : '';
  return `── [${frame.seq + 1}/${total}] +${secs}s · ${frame.triggers.join(
    '+',
  )} · screen=${frame.screen}${tasks} ──`;
}
