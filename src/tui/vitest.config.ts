import { defineProject } from 'vitest/config';
import { surfaceProject } from '../../vitest.shared.js';

export default defineProject(
  surfaceProject({
    name: 'tui',
    imports: ['env', 'store', 'tui'],
    ink: 'mock',
  }),
);
