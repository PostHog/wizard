/**
 * Jest mock for ink. Tests import workflow indexes whose content modules
 * use Ink's JSX components — those tests don't actually render anything,
 * so we stub Ink with no-op React elements.
 */

import React from 'react';

const Stub = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

export const Text = Stub;
export const Box = Stub;
export const Static = Stub;
export const Transform = Stub;
export const Newline = () => null;
export const Spacer = () => null;

export const render = () => ({
  unmount: () => undefined,
  waitUntilExit: () => Promise.resolve(),
  cleanup: () => undefined,
  clear: () => undefined,
  rerender: () => undefined,
});

export const useApp = () => ({ exit: () => undefined });
export const useInput = () => undefined;
export const useStdin = () => ({
  isRawModeSupported: false,
  stdin: process.stdin,
});
export const useStdout = () => ({
  stdout: process.stdout,
  write: () => undefined,
});
export const useFocus = () => ({ isFocused: false });
export const useFocusManager = () => ({
  enableFocus: () => undefined,
  disableFocus: () => undefined,
  focusNext: () => undefined,
  focusPrevious: () => undefined,
});

export const measureElement = () => ({ width: 80, height: 24 });
