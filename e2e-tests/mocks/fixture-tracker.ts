import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

class FixtureTracker {
  private readonly fixturesDir: string;
  private readonly trackingDir: string;
  private readonly existingFixturesFile: string;
  private readonly usedFixturesFile: string;

  constructor() {
    this.fixturesDir = this.getFixturesDirectory();
    this.trackingDir = path.join(this.fixturesDir, '.tracking');
    this.existingFixturesFile = path.join(
      this.trackingDir,
      'existing-fixtures.json',
    );
    this.usedFixturesFile = path.join(this.trackingDir, 'used-fixtures.json');
  }

  private getFixturesDirectory(): string {
    const findWizardRoot = (): string => {
      let currentDir = process.cwd();
      const root = path.parse(currentDir).root;

      while (currentDir !== root) {
        if (
          fs.existsSync(path.join(currentDir, 'wizard.config.js')) ||
          fs.existsSync(path.join(currentDir, 'package.json'))
        ) {
          if (path.basename(currentDir) === 'wizard') {
            return currentDir;
          }
        }
        if (path.basename(currentDir) === 'wizard') {
          return currentDir;
        }
        currentDir = path.dirname(currentDir);
      }
      return process.cwd();
    };

    return path.join(findWizardRoot(), 'e2e-tests', 'fixtures');
  }

  captureExistingFixtures(): void {
    if (!fs.existsSync(this.fixturesDir)) {
      return;
    }

    const existingFixtures = new Set<string>();
    const files = fs.readdirSync(this.fixturesDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.fixturesDir, file);
        existingFixtures.add(filePath);
      }
    }

    // Ensure tracking directory exists
    fs.mkdirSync(this.trackingDir, { recursive: true });

    // Write existing fixtures to file
    fs.writeFileSync(
      this.existingFixturesFile,
      JSON.stringify(Array.from(existingFixtures), null, 2),
    );

    // Initialize empty used fixtures file
    fs.writeFileSync(this.usedFixturesFile, JSON.stringify([], null, 2));
  }

  markFixtureAsUsed(requestBody: string): void {
    const hash = this.generateHashFromRequestBody(requestBody);
    const fixturePath = path.join(this.fixturesDir, `${hash}.json`);

    // Read current used fixtures
    let usedFixtures: string[] = [];
    if (fs.existsSync(this.usedFixturesFile)) {
      try {
        usedFixtures = JSON.parse(
          fs.readFileSync(this.usedFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        usedFixtures = [];
      }
    }

    // Add new fixture if not already tracked
    if (!usedFixtures.includes(fixturePath)) {
      usedFixtures.push(fixturePath);

      // Ensure tracking directory exists
      fs.mkdirSync(this.trackingDir, { recursive: true });

      // Write back to file
      fs.writeFileSync(
        this.usedFixturesFile,
        JSON.stringify(usedFixtures, null, 2),
      );
    }
  }

  cleanupUnusedFixtures(): void {
    let existingFixtures: string[] = [];
    let usedFixtures: string[] = [];

    // Read existing fixtures
    if (fs.existsSync(this.existingFixturesFile)) {
      try {
        existingFixtures = JSON.parse(
          fs.readFileSync(this.existingFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Error reading existing fixtures file:', error);
        return;
      }
    }

    // Read used fixtures
    if (fs.existsSync(this.usedFixturesFile)) {
      try {
        usedFixtures = JSON.parse(
          fs.readFileSync(this.usedFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Error reading used fixtures file:', error);
        usedFixtures = [];
      }
    }

    // Calculate unused fixtures
    const usedFixturesSet = new Set(usedFixtures);
    const unusedFixtures = existingFixtures.filter(
      (fixture) => !usedFixturesSet.has(fixture),
    );

    for (const fixturePath of unusedFixtures) {
      if (fs.existsSync(fixturePath)) {
        fs.unlinkSync(fixturePath);
        // eslint-disable-next-line no-console
        console.log(`Deleted unused fixture: ${path.basename(fixturePath)}`);
      }
    }

    // Clean up tracking files
    if (fs.existsSync(this.trackingDir)) {
      fs.rmSync(this.trackingDir, { recursive: true, force: true });
    }
  }

  private generateHashFromRequestBody(requestBody: string): string {
    return crypto.createHash('md5').update(requestBody).digest('hex');
  }

  retrieveQueryFixture(requestBody: string): unknown | null {
    const hash = this.generateHashFromRequestBody(requestBody);
    const fixturePath = path.join(this.fixturesDir, `${hash}.json`);

    if (!fs.existsSync(fixturePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }

  saveQueryFixture(requestBody: string, response: unknown): void {
    const hash = this.generateHashFromRequestBody(requestBody);
    const fixturePath = path.join(this.fixturesDir, `${hash}.json`);
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(response, null, 2));
  }

  getStats() {
    let existingFixtures: string[] = [];
    let usedFixtures: string[] = [];

    if (fs.existsSync(this.existingFixturesFile)) {
      try {
        existingFixtures = JSON.parse(
          fs.readFileSync(this.existingFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        // Ignore errors
      }
    }

    if (fs.existsSync(this.usedFixturesFile)) {
      try {
        usedFixtures = JSON.parse(
          fs.readFileSync(this.usedFixturesFile, 'utf8'),
        ) as string[];
      } catch (error) {
        // Ignore errors
      }
    }

    return {
      existingFixtures: existingFixtures.length,
      usedFixtures: usedFixtures.length,
      unusedFixtures: existingFixtures.length - usedFixtures.length,
    };
  }
}

export const fixtureTracker = new FixtureTracker();
