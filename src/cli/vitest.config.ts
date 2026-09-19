import { defineProject } from 'vitest/config';
import { surfaceProject } from '../../vitest.shared.js';

export default defineProject(
  surfaceProject({
    name: 'cli',
    imports: ['env', 'store', 'agent', 'tui', 'cli'],
    ink: 'forbidden',
  }),
);
