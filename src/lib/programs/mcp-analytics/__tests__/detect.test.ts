import { languagesFromEntries } from '@lib/programs/mcp-analytics/detect';

describe('languagesFromEntries', () => {
  it('reads a bare package.json as javascript', () => {
    expect(languagesFromEntries(['package.json', 'README.md'])).toEqual([
      'javascript',
    ]);
  });

  it('upgrades to typescript when a tsconfig sits alongside', () => {
    expect(languagesFromEntries(['package.json', 'tsconfig.json'])).toEqual([
      'typescript',
    ]);
  });

  it.each([
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'python'],
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['Gemfile', 'ruby'],
    ['composer.json', 'php'],
    ['pom.xml', 'java'],
  ])('maps %s to %s', (entry, language) => {
    expect(languagesFromEntries([entry])).toEqual([language]);
  });

  it('matches extension-based ecosystems', () => {
    expect(languagesFromEntries(['Server.csproj'])).toEqual(['csharp']);
  });

  it('reports every language in a polyglot repo, sorted and deduped', () => {
    expect(
      languagesFromEntries([
        'package.json',
        'tsconfig.json',
        'pyproject.toml',
        'go.mod',
        'requirements.txt',
      ]),
    ).toEqual(['go', 'python', 'typescript']);
  });

  it('returns nothing for a project with no recognizable manifest', () => {
    expect(languagesFromEntries(['README.md', 'LICENSE'])).toEqual([]);
  });
});
