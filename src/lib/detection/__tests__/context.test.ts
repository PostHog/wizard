import {
  gatherFrameworkContext,
  checkFrameworkVersion,
} from '@lib/detection/context';
import type { FrameworkConfig } from '@lib/framework-config';
import type { WizardOptions } from '@utils/types';

const baseOptions: WizardOptions = {
  installDir: '/test/dir',
  debug: false,
  forceInstall: false,
  default: false,
  signup: false,
  localMcp: false,
  ci: false,
  menu: false,
  benchmark: false,
  yaraReport: false,
};

describe('gatherFrameworkContext', () => {
  it('calls gatherContext and returns the result', async () => {
    const config = {
      metadata: {
        gatherContext: jest
          .fn()
          .mockResolvedValue({ routerType: 'app', srcDir: 'src' }),
      },
    } as unknown as FrameworkConfig;

    const result = await gatherFrameworkContext(config, baseOptions);

    expect(result).toEqual({ routerType: 'app', srcDir: 'src' });
    expect(config.metadata.gatherContext).toHaveBeenCalledWith(baseOptions);
  });

  it('returns {} when gatherContext is missing or throws', async () => {
    const noGather = { metadata: {} } as FrameworkConfig;
    expect(await gatherFrameworkContext(noGather, baseOptions)).toEqual({});

    const throws = {
      metadata: {
        gatherContext: jest.fn().mockRejectedValue(new Error('fail')),
      },
    } as unknown as FrameworkConfig;
    expect(await gatherFrameworkContext(throws, baseOptions)).toEqual({});
  });
});

describe('checkFrameworkVersion', () => {
  it('returns supported when no minimum is configured', async () => {
    const config = { detection: {} } as unknown as FrameworkConfig;
    const result = await checkFrameworkVersion(config, baseOptions);
    expect(result.supported).toBe(true);
  });

  it('returns supported when installed version meets minimum', async () => {
    const config = {
      detection: {
        minimumVersion: '14.0.0',
        getInstalledVersion: jest.fn().mockResolvedValue('15.2.3'),
      },
      metadata: { docsUrl: 'https://example.com/docs' },
    } as unknown as FrameworkConfig;

    expect((await checkFrameworkVersion(config, baseOptions)).supported).toBe(
      true,
    );
  });

  it('returns version details when installed version is below minimum', async () => {
    const config = {
      detection: {
        minimumVersion: '14.0.0',
        getInstalledVersion: jest.fn().mockResolvedValue('13.5.0'),
      },
      metadata: { docsUrl: 'https://example.com/docs' },
    } as unknown as FrameworkConfig;

    const result = await checkFrameworkVersion(config, baseOptions);
    expect(result.supported).toEqual({
      current: '13.5.0',
      minimum: '14.0.0',
      docsUrl: 'https://example.com/docs',
    });
  });
});
