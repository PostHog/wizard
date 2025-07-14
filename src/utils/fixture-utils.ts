import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { QueryOptions } from './query';

export const retrieveQueryFixture = <S>({
  message,
  model,
  region,
  schema,
  wizardHash,
}: QueryOptions<S>): S | null => {
  const fixturePath = getFixturePath({
    message,
    model,
    region,
    schema,
    wizardHash,
  });

  if (!fs.existsSync(fixturePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as S;
};

export const saveQueryFixture = <S>({
  message,
  model,
  region,
  schema,
  wizardHash,
  response,
}: QueryOptions<S> & { response: S }) => {
  const fixturePath = getFixturePath({
    message,
    model,
    region,
    schema,
    wizardHash,
  });

  // Don't overwrite existing fixtures
  if (fs.existsSync(fixturePath)) {
    return;
  }

  fs.writeFileSync(fixturePath, JSON.stringify(response, null, 2));
};

const generateHash = <S>({
  message,
  model,
  region,
  schema,
  wizardHash,
}: QueryOptions<S>) => {
  return crypto
    .createHash('md5')
    .update(JSON.stringify({ message, model, region, schema, wizardHash }))
    .digest('hex');
};

const getFixturePath = <S>({
  message,
  model,
  region,
  schema,
  wizardHash,
}: QueryOptions<S>) => {
  const hash = generateHash({ message, model, region, schema, wizardHash });
  return path.join(
    path.dirname(require?.main?.filename ?? ''),
    'fixtures',
    `${hash}.json`,
  );
};
