import { cliAddCommand } from '../../../tools/cli-steering/index';
import type { Command } from '../command';

export const cliCommand: Command = {
  name: 'cli',
  description: 'PostHog CLI agent integration commands',
  children: [cliAddCommand],
};
