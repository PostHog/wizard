import { cliAddCommand } from './add.js';
import type { Command } from '../command.js';

export const cliCommand: Command = {
  name: 'cli',
  description: 'PostHog CLI agent integration commands',
  children: [cliAddCommand],
};
