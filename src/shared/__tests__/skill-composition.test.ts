import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VARIANT_FILE,
  completeSkillFromPack,
  composeStepSkill,
  type SkillFiles,
} from '@shared/skill-composition';

const RULES = {
  file: 'references/COMMANDMENTS.md',
  description: 'Framework-specific rules the integration must follow',
};

/** A pack: its variant.json, built from `variant`, beside its other files. */
const pack = (variant: object, files: SkillFiles = {}): SkillFiles => ({
  [VARIANT_FILE]: JSON.stringify({
    id: 'nextjs-app-router',
    displayName: 'Next.js App Router',
    rules: null,
    products: {},
    ...variant,
  }),
  ...files,
});

const step = (body: string, files: SkillFiles = {}): SkillFiles => ({
  'SKILL.md': `---\nname: integration-init\n---\n\n${body}`,
  ...files,
});

const INIT = step(
  '# Initialize PostHog for {framework_name}\n\n## Reference\n\n{framework_docs}\n- `references/content-security-policy.md` - Content security policy\n{framework_rules}\n',
  { 'references/content-security-policy.md': 'the policy page' },
);

const NEXT = pack(
  {
    rules: RULES,
    products: {
      integration: [{ file: 'references/next-js.md', description: 'Next.js' }],
      'error-tracking': [
        {
          file: 'references/error-tracking/nextjs.md',
          description: 'Next.js error tracking installation',
        },
      ],
    },
  },
  {
    'references/next-js.md': 'the library page',
    'references/error-tracking/nextjs.md': 'the error tracking page',
    'references/COMMANDMENTS.md': 'the rules',
    'references/EXAMPLE.md': 'the example',
  },
);

describe('composeStepSkill', () => {
  it("adds the product's pages and the rules, and lists them where the skill left room", () => {
    const composed = composeStepSkill(INIT, NEXT, 'integration');

    expect(composed).toEqual({
      'SKILL.md':
        '---\nname: integration-init\n---\n\n# Initialize PostHog for Next.js App Router\n\n## Reference\n\n' +
        '- `references/next-js.md` - Next.js\n' +
        '- `references/content-security-policy.md` - Content security policy\n' +
        '- `references/COMMANDMENTS.md` - Framework-specific rules the integration must follow\n',
      'references/next-js.md': 'the library page',
      'references/content-security-policy.md': 'the policy page',
      'references/COMMANDMENTS.md': 'the rules',
    });
  });

  it("takes another product's pages out of the folder the pack keeps them in", () => {
    const composed = composeStepSkill(INIT, NEXT, 'error-tracking');

    expect(composed['references/nextjs.md']).toBe('the error tracking page');
    expect(composed['references/next-js.md']).toBeUndefined();
    expect(composed['SKILL.md']).toContain(
      '- `references/nextjs.md` - Next.js error tracking installation\n',
    );
  });

  it('drops a line the pack has nothing for', () => {
    const composed = composeStepSkill(
      step('{framework_docs}\n- own\n{framework_rules}\n'),
      pack({ products: { integration: [] } }),
      'integration',
    );

    expect(composed['SKILL.md']).toBe(
      '---\nname: integration-init\n---\n\n- own\n',
    );
  });

  it('lets a later file replace an earlier one of the same name, as the build does', () => {
    const composed = composeStepSkill(
      step('{framework_docs}\n', { 'references/shared.md': 'the step page' }),
      pack(
        {
          products: {
            integration: [
              { file: 'references/a/ios.md', description: 'First' },
              { file: 'references/ios.md', description: 'Second' },
              { file: 'references/shared.md', description: 'Third' },
            ],
          },
        },
        {
          'references/a/ios.md': 'first',
          'references/ios.md': 'second',
          'references/shared.md': 'the pack page',
        },
      ),
      'integration',
    );

    expect(composed['references/ios.md']).toBe('second');
    expect(composed['references/shared.md']).toBe('the step page');
    expect(composed['SKILL.md']).toContain(
      '- `references/ios.md` - First\n- `references/ios.md` - Second\n- `references/shared.md` - Third\n',
    );
  });

  it.each([
    ['has no variant.json', { 'SKILL.md': '' }, /has no variant\.json/],
    [
      'has a variant.json it cannot read',
      { [VARIANT_FILE]: '{"id":"x"}' },
      /malformed variant\.json/,
    ],
    [
      'lists no pages for the product',
      pack({ products: {} }),
      /lists no integration pages/,
    ],
    [
      'names a product only through an inherited property',
      pack({ products: {} }),
      /lists no constructor pages/,
      'constructor',
    ],
    [
      'lists a page it does not have',
      pack({
        products: {
          integration: [{ file: 'references/gone.md', description: 'Gone' }],
        },
      }),
      /lists references\/gone\.md without it/,
    ],
    [
      'lists a page with no usable name',
      pack(
        {
          products: {
            integration: [{ file: 'references/..', description: 'Up' }],
          },
        },
        { 'references/..': 'x' },
      ),
      /unusable reference name/,
    ],
  ])(
    'fails when the pack %s',
    (_, packFiles, message, product = 'integration') => {
      expect(() =>
        composeStepSkill(step('{framework_docs}\n'), packFiles, product),
      ).toThrow(message);
    },
  );
});

describe('completeSkillFromPack', () => {
  let dir: string;

  const write = (root: string, files: SkillFiles) => {
    for (const [file, contents] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  };
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-composition-'));
    write(path.join(dir, 'skill'), INIT);
    write(path.join(dir, 'pack'), NEXT);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('completes the installed skill in place, and leaves the pack as it is', () => {
    completeSkillFromPack(
      path.join(dir, 'skill'),
      path.join(dir, 'pack'),
      'integration',
      dir,
    );

    expect(read('skill/SKILL.md')).toContain(
      '# Initialize PostHog for Next.js App Router',
    );
    expect(read('skill/references/next-js.md')).toBe('the library page');
    expect(read('skill/references/COMMANDMENTS.md')).toBe('the rules');
    expect(fs.existsSync(path.join(dir, 'skill/references/EXAMPLE.md'))).toBe(
      false,
    );
    expect(read('pack/references/next-js.md')).toBe('the library page');
  });

  it('leaves the skill as it was when the pack cannot complete it', () => {
    fs.rmSync(path.join(dir, 'pack', VARIANT_FILE));

    expect(() =>
      completeSkillFromPack(
        path.join(dir, 'skill'),
        path.join(dir, 'pack'),
        'integration',
        dir,
      ),
    ).toThrow(/has no variant\.json/);
    expect(read('skill/SKILL.md')).toBe(INIT['SKILL.md']);
    expect(fs.readdirSync(path.join(dir, 'skill/references'))).toEqual([
      'content-security-policy.md',
    ]);
  });

  // A project can ship links in the cache folder, and a write through one lands outside the skill.
  it.skipIf(process.platform === 'win32').each([
    [
      'a page that is a link to a file',
      () => {
        fs.writeFileSync(path.join(dir, 'outside.md'), 'outside');
        fs.symlinkSync(
          path.join(dir, 'outside.md'),
          path.join(dir, 'skill/references/next-js.md'),
        );
      },
      'skill',
    ],
    [
      'a references folder that is a link',
      () => {
        fs.rmSync(path.join(dir, 'skill/references'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'outside'));
        fs.symlinkSync(
          path.join(dir, 'outside'),
          path.join(dir, 'skill/references'),
        );
      },
      'skill',
    ],
    [
      'a skill folder that is a link',
      () => {
        fs.symlinkSync(path.join(dir, 'skill'), path.join(dir, 'linked'));
      },
      'linked',
    ],
  ])('writes nothing through %s', (_, arrange, skill) => {
    arrange();

    expect(() =>
      completeSkillFromPack(
        path.join(dir, skill),
        path.join(dir, 'pack'),
        'integration',
        dir,
      ),
    ).toThrow(/through a link/);
    expect(read('skill/SKILL.md')).toBe(INIT['SKILL.md']);
    if (fs.existsSync(path.join(dir, 'outside.md'))) {
      expect(read('outside.md')).toBe('outside');
    }
    if (fs.existsSync(path.join(dir, 'outside'))) {
      expect(fs.readdirSync(path.join(dir, 'outside'))).toEqual([]);
    }
  });

  it('refuses a skill outside the boundary', () => {
    expect(() =>
      completeSkillFromPack(
        path.join(dir, 'skill'),
        path.join(dir, 'pack'),
        'integration',
        path.join(dir, 'pack'),
      ),
    ).toThrow(/escapes the skill/);
    expect(read('skill/SKILL.md')).toBe(INIT['SKILL.md']);
  });
});
