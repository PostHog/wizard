/** Commit a routed control setter by name: how the TUI core's tests answer a program's or tool's screen. */
import { settersFor } from '@tui/control/setters';
import type { WizardStore } from '@tui/store';

export function applySetter(
  store: WizardStore,
  name: string,
  params: Record<string, unknown> = {},
): void {
  const setter = settersFor(store).find((s) => s.name === name);
  if (!setter) throw new Error(`No control setter named ${name}`);
  setter.apply(params);
}
