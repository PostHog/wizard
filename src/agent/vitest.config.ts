import { defineProject } from 'vitest/config';
import { surfaceProject } from '../../vitest.shared.js';

export default defineProject(
  surfaceProject({
    name: 'agent',
    imports: ['env', 'store', 'agent'],
    ink: 'forbidden',
  }),
);
