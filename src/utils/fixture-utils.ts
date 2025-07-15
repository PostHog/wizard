import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const generateHashFromRequestBody = (requestBody: string) => {
  return crypto.createHash('md5').update(requestBody).digest('hex');
};

const getFixturePathFromHash = (hash: string) => {
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

  return path.join(findWizardRoot(), 'e2e-tests', 'fixtures', `${hash}.json`);
};

export const retrieveQueryFixture = (requestBody: string): unknown | null => {
  const hash = generateHashFromRequestBody(requestBody);
  const fixturePath = getFixturePathFromHash(hash);

  if (!fs.existsSync(fixturePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
};

export const saveQueryFixture = (requestBody: string, response: unknown) => {
  const hash = generateHashFromRequestBody(requestBody);
  const fixturePath = getFixturePathFromHash(hash);

  if (fs.existsSync(fixturePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(response, null, 2));
};
