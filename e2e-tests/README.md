# End-to-end tests for PostHog wizard

## Running Tests Locally

E2E Tests can be run locally from the root of the project with:

`pnpm test:e2e`

To run a specific test application

`pnpm test:e2e NextJS`

To record new fixtures:

`pnpm test:e2e-record`

## Writing Framework tests

Most of the E2E framework tests share a lot of common functionality such as
terminal inputs and test setup/teardown. To accomodate for the large amount of
frameworks we test, we expose the `createFrameworkTest` function.

For example usage, see one of the tests in `e2e-tests/tests` such as
`nextjs-app-router.test.ts`. Each framework test also requires a test
application to be defined in `test-applications`.

To adjust the default behaviour of the framework, also take a look at
`DEFAULT_WIZARD_STEPS` in `e2e-tests/utils/framework-test-utils.ts`

## Fixture Generation

To be able to mock our LLM calls in the E2E tests, we need to have a realistic
fixture. To generate them, we a call to the `/query` endpoint in PostHog. We
save this response as a fixture in `e2e-tests/fixtures`. The filename represents
the hashed request body to the endpoint. When we run the tests again, we reuse
those fixtures.

Whenever the request body to the LLM change we also regenerate the fixture. The
request body can change because of a few things:

- Prompt:
  - The system propmt
  - The provided framework files
  - etc.
- LLM Model
- Response Schema

Because we use a set seed for the LLM, this means our tests are deterministic
and actually reflective of how they would work in production as well.

Two environment variables control our fixture management:

`RECORD_FIXTURES` performs a `/query` request to create a fixture if no matching
fixture is found the for the request body. Can be `true or false`. If `false`
and no matching fixture is found, the test will fail.

`CLEANUP_UNUSED_FIXTURES` deletes fixtures that were not used during an E2E jest
run. Should only be set to true when running all E2E tests. Can be `true` or
`false`

### Utilities

`utils/` contains helpers such as the wizard runner, assertion tools and file
modifiers that can be used in (`*.test.ts`).

#### Helpers

- `startWizardInstance` - Starts a new instance of `WizardTestEnv`.

- `initGit` - Initializes a temporary git repository in the test project.
- `cleanupGit` - Cleans up the temporary git repository in the test project.
- `revertLocalChanges` - Reverts local changes (git tracked or untracked) in the
  test project.

- `createFile` - Creates a file (optionally with content) in the test project.
- `modifyFile` - Modifies a file in the test project.

- `checkFileExists` - Checks if a file exists in the test project.
- `checkPackageJson` - Checks if the package package exists in the dependencies
  of the test project's `package.json`.

- `checkIfBuilds` - Checks if the test project builds successfully.
- `checkIfRunsOnDevMode` - Checks if the test project runs on dev mode
  successfully.
- `checkIfRunsOnProdMode` - Checks if the test project runs on prod mode
  successfully.

#### `WizardTestEnv`

`WizardTestEnv` is a class that can be used to run the PostHog wizard in a test
environment. It provides methods to run the wizard with specific arguments and
stdio.
