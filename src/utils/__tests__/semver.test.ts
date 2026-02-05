import { createVersionBucket } from '../semver';

describe('createVersionBucket', () => {
  describe('without minimum threshold', () => {
    const getVersionBucket = createVersionBucket();

    it('returns "none" for undefined version', () => {
      expect(getVersionBucket(undefined)).toBe('none');
    });

    it('returns "none" for empty string', () => {
      expect(getVersionBucket('')).toBe('none');
    });

    it('returns major version bucket for exact versions', () => {
      expect(getVersionBucket('1.0.0')).toBe('1.x');
      expect(getVersionBucket('2.5.3')).toBe('2.x');
      expect(getVersionBucket('15.3.2')).toBe('15.x');
    });

    it('returns major version bucket for semver ranges', () => {
      expect(getVersionBucket('^1.0.0')).toBe('1.x');
      expect(getVersionBucket('~2.5.0')).toBe('2.x');
      expect(getVersionBucket('>=15.0.0')).toBe('15.x');
    });

    it('returns "unknown" for invalid semver (caught by try/catch)', () => {
      expect(getVersionBucket('not-a-version')).toBe('unknown');
      expect(getVersionBucket('abc')).toBe('unknown');
    });

    it('handles version 0.x correctly', () => {
      expect(getVersionBucket('0.1.0')).toBe('0.x');
      expect(getVersionBucket('0.0.1')).toBe('0.x');
    });
  });

  describe('with minimum threshold', () => {
    describe('threshold of 11 (Next.js style)', () => {
      const getVersionBucket = createVersionBucket(11);

      it('returns major version bucket for versions >= threshold', () => {
        expect(getVersionBucket('11.0.0')).toBe('11.x');
        expect(getVersionBucket('12.5.3')).toBe('12.x');
        expect(getVersionBucket('15.3.2')).toBe('15.x');
      });

      it('returns "<threshold" bucket for versions below threshold', () => {
        expect(getVersionBucket('10.0.0')).toBe('<11.0.0');
        expect(getVersionBucket('9.5.0')).toBe('<11.0.0');
        expect(getVersionBucket('1.0.0')).toBe('<11.0.0');
      });

      it('handles semver ranges correctly', () => {
        expect(getVersionBucket('^15.0.0')).toBe('15.x');
        expect(getVersionBucket('^10.0.0')).toBe('<11.0.0');
      });
    });

    describe('threshold of 6 (React Router style)', () => {
      const getVersionBucket = createVersionBucket(6);

      it('returns major version bucket for versions >= threshold', () => {
        expect(getVersionBucket('6.0.0')).toBe('6.x');
        expect(getVersionBucket('7.1.0')).toBe('7.x');
      });

      it('returns "<threshold" bucket for versions below threshold', () => {
        expect(getVersionBucket('5.3.0')).toBe('<6.0.0');
        expect(getVersionBucket('4.0.0')).toBe('<6.0.0');
      });
    });

    describe('threshold of 3 (Django style)', () => {
      const getVersionBucket = createVersionBucket(3);

      it('returns major version bucket for versions >= threshold', () => {
        expect(getVersionBucket('3.0.0')).toBe('3.x');
        expect(getVersionBucket('4.2.1')).toBe('4.x');
        expect(getVersionBucket('5.0.0')).toBe('5.x');
      });

      it('returns "<threshold" bucket for versions below threshold', () => {
        expect(getVersionBucket('2.2.0')).toBe('<3.0.0');
        expect(getVersionBucket('1.11.0')).toBe('<3.0.0');
      });
    });

    describe('threshold of 2 (Flask style)', () => {
      const getVersionBucket = createVersionBucket(2);

      it('returns major version bucket for versions >= threshold', () => {
        expect(getVersionBucket('2.0.0')).toBe('2.x');
        expect(getVersionBucket('3.0.0')).toBe('3.x');
      });

      it('returns "<threshold" bucket for versions below threshold', () => {
        expect(getVersionBucket('1.1.0')).toBe('<2.0.0');
        expect(getVersionBucket('0.12.0')).toBe('<2.0.0');
      });
    });

    describe('threshold of 9 (Laravel style)', () => {
      const getVersionBucket = createVersionBucket(9);

      it('returns major version bucket for versions >= threshold', () => {
        expect(getVersionBucket('9.0.0')).toBe('9.x');
        expect(getVersionBucket('10.0.0')).toBe('10.x');
        expect(getVersionBucket('11.0.0')).toBe('11.x');
      });

      it('returns "<threshold" bucket for versions below threshold', () => {
        expect(getVersionBucket('8.0.0')).toBe('<9.0.0');
        expect(getVersionBucket('7.0.0')).toBe('<9.0.0');
      });
    });
  });

  describe('edge cases', () => {
    const getVersionBucket = createVersionBucket();

    it('handles version with only major.minor', () => {
      expect(getVersionBucket('1.0')).toBe('1.x');
      expect(getVersionBucket('15.3')).toBe('15.x');
    });

    it('handles prerelease versions', () => {
      expect(getVersionBucket('1.0.0-beta.1')).toBe('1.x');
      expect(getVersionBucket('2.0.0-rc.1')).toBe('2.x');
      expect(getVersionBucket('15.0.0-canary.1')).toBe('15.x');
    });

    it('handles versions with build metadata', () => {
      expect(getVersionBucket('1.0.0+build.123')).toBe('1.x');
    });

    it('handles whitespace-only string (semver treats as version 0)', () => {
      // Note: semver's minVersion treats whitespace as a valid range matching version 0
      expect(getVersionBucket('   ')).toBe('0.x');
    });
  });
});
