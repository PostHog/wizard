import { render } from 'ink-testing-library';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { ScreenContainer } from '../../primitives/ScreenContainer.js';
import { createScreens, type ScreenServices } from '../../screen-registry.js';
import type { FlowStore } from '@store/state/store';
import { UiStore } from '../../ui-store.js';

export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface RenderedScreen {
  app: ReturnType<typeof render>;
  frame: string;
}

// OSC 8 hyperlinks (LinkText) as well as the usual CSI colour/cursor codes.
// eslint-disable-next-line no-control-regex
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const CSI_RE = /[\x1b\x9b][[()#;?]*[0-9;]*[A-Za-z]/g;

export function toFrameText(raw: string | undefined): string {
  return `${(raw ?? '').replace(OSC_RE, '').replace(CSI_RE, '')}\n`
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');
}

export async function flushInk(ms = 50): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** The shell App.tsx builds: router-resolved screen inside the full chrome. */
export function screenShell(
  store: FlowStore,
  services: ScreenServices,
): ReactNode {
  return (
    <ScreenContainer
      store={store}
      ui={new UiStore(store)}
      screens={createScreens(store, services)}
    />
  );
}

export async function renderScreen(
  store: FlowStore,
  element: ReactNode,
  { columns, rows }: TerminalSize,
): Promise<RenderedScreen> {
  const app = render(<>{element}</>);
  const dimensions = { columns, rows, isTTY: true };
  for (const [key, value] of Object.entries(dimensions)) {
    Object.defineProperty(app.stdout, key, { value, configurable: true });
  }
  app.stdout.emit('resize');
  store.emitChange();
  await flushInk();
  return { app, frame: toFrameText(app.lastFrame()) };
}
