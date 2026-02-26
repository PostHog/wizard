/**
 * Shared style constants for TUI layout primitives.
 */

export enum HAlign {
  Left = 'flex-start',
  Center = 'center',
  Right = 'flex-end',
}

export enum VAlign {
  Top = 'flex-start',
  Center = 'center',
  Bottom = 'flex-end',
}

export const Colors = {
  primary: 'cyan',
  accent: '#F9BD2B',
  success: 'green',
  error: 'red',
  muted: 'gray',
} as const;

export const Icons = {
  diamond: '\u25C6',
  diamondOpen: '\u25C7',
  check: '\u2714',
  warning: '\u26A0',
  squareFilled: '\u25FC',
  squareOpen: '\u25FB',
  triangleRight: '\u25B6',
  triangleSmallRight: '\u25B8',
  bullet: '\u2022',
} as const;
