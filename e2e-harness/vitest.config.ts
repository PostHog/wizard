import { defineProject } from 'vitest/config';
import { surfaceProject } from '../vitest.shared.js';

export default defineProject(
  surfaceProject({
    name: 'harness',
    imports: ['env', 'store', 'agent', 'tui', 'cli', 'harness'],
    ink: 'mock',
  }),
);
