import { defineProject } from 'vitest/config';
import { surfaceProject } from '../../../vitest.shared.js';

export default defineProject(
  surfaceProject({
    name: 'architecture',
    imports: ['env', 'store'],
    ink: 'forbidden',
    include: ['**/*.test.ts'],
  }),
);
