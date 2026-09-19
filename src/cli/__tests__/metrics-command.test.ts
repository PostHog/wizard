import { metricsConfig } from '@store/programs';
import { metricsCommand } from '../commands/metrics.js';

describe('metrics command', () => {
  it('is exposed as a yargs command via nativeCommandFactory', () => {
    expect(metricsCommand.name).toBe('metrics');
    expect(metricsCommand.description).toBe(metricsConfig.description);
    expect(typeof metricsCommand.handler).toBe('function');
  });
});
