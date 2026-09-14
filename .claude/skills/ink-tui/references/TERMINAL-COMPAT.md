# Terminal behavior

## Startup and exit

[startTUI](../../../../src/ui/tui/start-tui.ts) creates the store, installs
`InkUI`, renders the app, and starts program initialization.
[terminal.ts](../../../../src/ui/tui/terminal.ts) owns the alternate screen
buffer and black background shared with the playground. Reuse this lifecycle.

Cleanup unmounts Ink, restores the terminal, and prints the
[exit line](../../../../src/ui/tui/exit-line.ts). Ink teardown on Ctrl+C is
followed by analytics shutdown and process exit so background handles do not
leave a process running without its interface.

## Dimensions and resizing

[useStdoutDimensions](../../../../src/ui/tui/hooks/useStdoutDimensions.ts)
subscribes to resize events and supplies fallback dimensions when a stream has
none.

[ScreenContainer](../../../../src/ui/tui/primitives/ScreenContainer.tsx) centers
and caps content width. On a real TTY, it shows
[ViewportTooSmall](../../../../src/ui/tui/primitives/ViewportTooSmall.tsx) below
the minimum dimensions declared there. The underlying screen stays mounted and
is hidden from layout, preserving input state and avoiding repeated mount
effects. Its input handlers still run; the guard does not pause the wizard.
Piped stdout does not activate this resize notice.

Use
[ViewportGuardDemo](../../../../src/ui/tui/playground/demos/ViewportGuardDemo.tsx)
to inspect the guard. For a layout change, inspect the affected screen near the
minimum size and at a wider size, including expanded status or the HUD if those
share its available height.

## Noninteractive execution

Mode selection belongs to command/runner entry points. The
[default integration command](../../../../src/commands/basic-integration/index.ts)
routes explicit CI/headless requests separately and rejects a detected
noninteractive environment for the ordinary interactive path.
[Environment detection](../../../../src/utils/environment.ts) checks
stdout/stderr TTY state outside development mode; checking stdin alone does not
describe this command's behavior.

`--ci` is a development/test path. The separate experimental headless contract
is defined in [headless-mode.ts](../../../../src/lib/headless-mode.ts); keep its
hidden flag out of user-facing guidance. Other commands can have their own
fallback, such as
[MCP TUI availability](../../../../src/commands/mcp/tui-availability.ts).

Do not add an automatic default-answer or Inquirer fallback in a screen.
Noninteractive behavior belongs in [LoggingUI](../../../../src/ui/logging-ui.ts)
and the command/runner contract, including explicit handling of interactions
that cannot be answered.
