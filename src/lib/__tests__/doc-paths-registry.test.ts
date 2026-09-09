import {
  isWizardDocumentationPath,
  registerWizardDocPaths,
  resetWizardDocPathsForTests,
} from '@lib/doc-paths-registry';

describe('doc-paths registry', () => {
  beforeEach(() => {
    resetWizardDocPathsForTests();
  });

  it('matches a registered basename anywhere in the tree', () => {
    registerWizardDocPaths(['.posthog-events.json']);
    expect(isWizardDocumentationPath('/tmp/project/.posthog-events.json')).toBe(
      true,
    );
    expect(
      isWizardDocumentationPath('deep/nested/dir/.posthog-events.json'),
    ).toBe(true);
  });

  it('matches a registered pattern against the basename', () => {
    registerWizardDocPaths([/^\.posthog-events-inventory\.part-\d+\.json$/]);
    expect(
      isWizardDocumentationPath('/p/.posthog-events-inventory.part-3.json'),
    ).toBe(true);
    expect(isWizardDocumentationPath('/p/.posthog-events-inventory.json')).toBe(
      false,
    );
  });

  it('does not match unregistered paths, and never matches undefined', () => {
    registerWizardDocPaths(['.posthog-events.json']);
    expect(isWizardDocumentationPath('/tmp/project/src/index.ts')).toBe(false);
    expect(isWizardDocumentationPath(undefined)).toBe(false);
  });

  it('matches on the basename only — a doc filename used as a directory does not qualify its contents', () => {
    registerWizardDocPaths(['.posthog-events.json']);
    expect(
      isWizardDocumentationPath('/tmp/.posthog-events.json/secrets.ts'),
    ).toBe(false);
  });

  it('accumulates registrations and tolerates duplicates and undefined', () => {
    registerWizardDocPaths(['a-report.md']);
    registerWizardDocPaths(['a-report.md', 'b-report.md']);
    registerWizardDocPaths(undefined);
    expect(isWizardDocumentationPath('x/a-report.md')).toBe(true);
    expect(isWizardDocumentationPath('x/b-report.md')).toBe(true);
  });
});

describe('program registry populates the doc-paths registry', () => {
  // Loading the program registry is the production population path; this
  // pins that every doc file the security hooks suppressed before the
  // inversion (wizard#594) is still covered after it.
  it('registers the doc paths every program declares', async () => {
    await import('@lib/programs/program-registry');

    const covered = [
      '.posthog-events.json', // posthog-integration event plan
      'posthog-audit-report.md', // audit report
      'posthog-events-audit-report.md', // events-audit report
      '.posthog-events-inventory.json', // events-audit inventory
      '.posthog-events-inventory.part-7.json', // events-audit inventory parts
    ];
    for (const file of covered) {
      expect(isWizardDocumentationPath(`/tmp/project/${file}`)).toBe(true);
    }
    expect(isWizardDocumentationPath('/tmp/project/src/index.ts')).toBe(false);
  });
});
