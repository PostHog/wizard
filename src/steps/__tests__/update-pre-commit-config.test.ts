import * as fs from 'fs';
import path from 'path';
import { updatePreCommitConfigStep } from '../update-pre-commit-config';
import { Integration } from '../../lib/constants';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

jest.mock('../../utils/analytics', () => ({
  analytics: {
    capture: jest.fn(),
    setTag: jest.fn(),
  },
}));

jest.mock('../../utils/clack', () => ({
  log: {
    warn: jest.fn(),
    success: jest.fn(),
  },
}));

describe('updatePreCommitConfigStep', () => {
  const mockOptions = {
    installDir: '/test/project',
    integration: Integration.django,
  };

  const existsSyncMock = fs.existsSync as jest.Mock;
  const readFileMock = fs.promises.readFile as jest.Mock;
  const writeFileMock = fs.promises.writeFile as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('config file discovery', () => {
    it('returns updated: false when no config file exists', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await updatePreCommitConfigStep(mockOptions);

      expect(result).toEqual({ updated: false });
    });

    it.each([
      ['.pre-commit-config.yaml', '.pre-commit-config.yaml'],
      ['.pre-commit-config.yml', '.pre-commit-config.yml'],
    ])('reads %s when it exists', async (existingFile, expectedFile) => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(existingFile),
      );
      readFileMock.mockResolvedValue('repos: []');

      await updatePreCommitConfigStep(mockOptions);

      expect(readFileMock).toHaveBeenCalledWith(
        path.join('/test/project', expectedFile),
        'utf8',
      );
    });

    it('prefers .yaml over .yml when both exist', async () => {
      existsSyncMock.mockReturnValue(true); // Both exist
      readFileMock.mockResolvedValue('repos: []');

      await updatePreCommitConfigStep(mockOptions);

      expect(readFileMock).toHaveBeenCalledWith(
        path.join('/test/project', '.pre-commit-config.yaml'),
        'utf8',
      );
    });
  });

  describe('adding posthog dependency', () => {
    beforeEach(() => {
      existsSyncMock.mockReturnValue(true);
      writeFileMock.mockResolvedValue(undefined);
    });

    it.each(['mypy', 'pyright', 'pytype'])(
      'adds posthog to %s hook',
      async (hookId) => {
        readFileMock.mockResolvedValue(`
repos:
  - repo: https://example.com/${hookId}
    hooks:
      - id: ${hookId}
`);

        const result = await updatePreCommitConfigStep(mockOptions);

        expect(result).toEqual({ updated: true });
        const writtenContent = writeFileMock.mock.calls[0][1] as string;
        expect(writtenContent).toContain('posthog');
      },
    );

    it('adds posthog to all type-checking hooks when multiple exist', async () => {
      readFileMock.mockResolvedValue(`
repos:
  - repo: https://github.com/pre-commit/mirrors-mypy
    hooks:
      - id: mypy
  - repo: https://github.com/microsoft/pyright
    hooks:
      - id: pyright
`);

      await updatePreCommitConfigStep(mockOptions);

      const writtenContent = writeFileMock.mock.calls[0][1] as string;
      expect(writtenContent.match(/posthog/g)).toHaveLength(2);
    });

    it('preserves existing additional_dependencies', async () => {
      readFileMock.mockResolvedValue(`
repos:
  - repo: https://github.com/pre-commit/mirrors-mypy
    hooks:
      - id: mypy
        additional_dependencies:
          - django-stubs
          - types-requests
`);

      await updatePreCommitConfigStep(mockOptions);

      const writtenContent = writeFileMock.mock.calls[0][1] as string;
      expect(writtenContent).toContain('django-stubs');
      expect(writtenContent).toContain('types-requests');
      expect(writtenContent).toContain('posthog');
    });
  });

  describe('idempotency', () => {
    beforeEach(() => {
      existsSyncMock.mockReturnValue(true);
    });

    it.each([
      'posthog',
      'posthog==3.0.0',
      'posthog>=2.0.0',
      'posthog<=3.0.0',
      'posthog~=2.0',
      'posthog!=1.0.0',
      'posthog[sentry]',
    ])(
      'does not modify when "%s" already in dependencies',
      async (existingDep) => {
        readFileMock.mockResolvedValue(`
repos:
  - repo: https://github.com/pre-commit/mirrors-mypy
    hooks:
      - id: mypy
        additional_dependencies:
          - ${existingDep}
`);

        const result = await updatePreCommitConfigStep(mockOptions);

        expect(result).toEqual({ updated: false });
        expect(writeFileMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('configs without type-checking hooks', () => {
    beforeEach(() => {
      existsSyncMock.mockReturnValue(true);
    });

    it.each([
      ['no repos key', 'default_language_version:\n  python: python3'],
      ['empty repos', 'repos: []'],
      ['repos without hooks', 'repos:\n  - repo: local'],
      [
        'only non-type-checking hooks',
        `repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    hooks:
      - id: trailing-whitespace`,
      ],
    ])('returns updated: false for %s', async (_desc, content) => {
      readFileMock.mockResolvedValue(content);

      const result = await updatePreCommitConfigStep(mockOptions);

      expect(result).toEqual({ updated: false });
      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      existsSyncMock.mockReturnValue(true);
    });

    it('returns updated: false on read error', async () => {
      readFileMock.mockRejectedValue(new Error('Permission denied'));

      const result = await updatePreCommitConfigStep(mockOptions);

      expect(result).toEqual({ updated: false });
    });

    it('returns updated: false on invalid YAML', async () => {
      readFileMock.mockResolvedValue('invalid: yaml: content: [');

      const result = await updatePreCommitConfigStep(mockOptions);

      expect(result).toEqual({ updated: false });
    });

    it('returns updated: false on write error', async () => {
      readFileMock.mockResolvedValue(`
repos:
  - repo: https://github.com/pre-commit/mirrors-mypy
    hooks:
      - id: mypy
`);
      writeFileMock.mockRejectedValue(new Error('Disk full'));

      const result = await updatePreCommitConfigStep(mockOptions);

      expect(result).toEqual({ updated: false });
    });
  });
});
