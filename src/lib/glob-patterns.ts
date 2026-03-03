/** Glob ignore patterns for Python project detection. */
export const PYTHON_DETECTION_IGNORES = [
  '**/node_modules/**',
  '**/venv/**',
  '**/.venv/**',
  '**/env/**',
  '**/.env/**',
];

/** Extended ignores that also exclude __pycache__ (for source file scans). */
export const PYTHON_SOURCE_IGNORES = [
  ...PYTHON_DETECTION_IGNORES,
  '**/__pycache__/**',
];
