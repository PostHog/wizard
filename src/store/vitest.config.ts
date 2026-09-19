import { defineProject } from 'vitest/config';
import { surfaceProject } from '../../vitest.shared.js';

export default defineProject(
  surfaceProject({
    name: 'store',
    imports: ['env', 'store'],
    ink: 'forbidden',
  }),
);
