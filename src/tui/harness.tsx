/**
 * What the e2e harness takes from the TUI in its own process: a store with no
 * terminal, the real screens on a test terminal, and the state a store holds.
 * The entry loads this module on first use, and its declarations name no Ink or
 * React type, so the harness reads them without either.
 */
import { EventEmitter } from 'node:events';
import { render } from 'ink';
import type { ProgramId } from '@programs';
import { listFlowOwners } from './flow-owner.js';
import { ScreenContainer } from './primitives/index.js';
import { Overlay, ScreenId } from './screen-ids.js';
import { createScreens, createServices } from './screen-registry.js';
import type { McpInstaller } from './services/mcp-installer.js';
import { WizardStore } from './store.js';
import { initialTuiState, type TuiState } from './tui-state.js';

/** What a mounted screen reads from the machine, which a test may replace. */
export type MountServices = { mcpInstaller?: McpInstaller };

/** The screens on a test terminal. */
export type MountedScreens = {
  /** Type into the screens, as the terminal would deliver the keys. */
  write: (input: string) => void;
  unmount: () => void;
};

/** A terminal that draws nowhere: 100 columns, its frames dropped. */
class TestStdout extends EventEmitter {
  readonly columns = 100;
  write = (): boolean => true;
}

/** A terminal input the test writes to. */
class TestStdin extends EventEmitter {
  isTTY = true;
  private pending: string | null = null;

  write = (input: string): void => {
    this.pending = input;
    this.emit('readable');
    this.emit('data', input);
  };

  read = (): string | null => {
    const input = this.pending;
    this.pending = null;
    return input;
  };

  setEncoding = (): void => undefined;
  setRawMode = (): void => undefined;
  resume = (): void => undefined;
  pause = (): void => undefined;
  ref = (): void => undefined;
  unref = (): void => undefined;
}

/** A store for `programId` with no terminal. */
export function createTuiStore(programId: ProgramId): WizardStore {
  return new WizardStore(programId);
}

/** Render the screens `store` shows on a test terminal, with `services` in place of the machine's. */
export function mountScreens(
  store: WizardStore,
  services: MountServices = {},
): MountedScreens {
  const stdin = new TestStdin();
  const app = render(
    <ScreenContainer
      store={store}
      screens={createScreens(store, { ...createServices(store), ...services })}
    />,
    {
      stdout: new TestStdout() as unknown as NodeJS.WriteStream,
      stderr: new TestStdout() as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return { write: stdin.write, unmount: app.unmount };
}

/** The state only the screens use, as `store` holds it now. */
export function readTuiState(store: WizardStore): TuiState {
  return Object.fromEntries(
    Object.keys(initialTuiState()).map((key) => [
      key,
      store[key as keyof TuiState],
    ]),
  ) as TuiState;
}

/** Every screen id the TUI mounts: the core's, the overlays and each program's and tool's own. */
export function tuiScreenIds(): string[] {
  return [
    ...new Set([
      ...Object.values<string>(ScreenId),
      ...Object.values<string>(Overlay),
      ...listFlowOwners().flatMap((owner) => Object.keys(owner.screens ?? {})),
    ]),
  ];
}
