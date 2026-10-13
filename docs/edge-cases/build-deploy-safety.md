# Changes that break builds or deploys

3 cases. Part of the [edge case catalogue](../edge-cases.md).

## Xcode open while project files are edited

**Problem.** An agent cannot see that the IDE has the project open. Xcode then rewrites project.pbxproj on its next save, and nothing reports an error.

**Impact.** Silent: Xcode overwrites the edit and the PostHog package reference disappears.

**Rule location.** `wizard: src/frameworks/swift/swift-wizard-agent.ts` (SWIFT\_AGENT\_CONFIG.metadata.preRunNotice)

**Sources.** [PostHog/wizard#259](https://github.com/PostHog/wizard/pull/259)

**Frameworks.** `swift`, `ios`

**Wrong:**

```text
// Xcode has MyApp.xcodeproj open
// agent edits project.pbxproj in place:
// + XCRemoteSwiftPackageReference + XCSwiftPackageProductDependency
// Xcode rewrites project.pbxproj on next save; edit lost
```

**Fixed:**

```ts
metadata: {
  name: 'Swift (iOS/macOS)',
  preRunNotice:
    'Please close the Xcode project before proceeding. Xcode may overwrite changes the wizard makes to project files.',
}
```

## Old SDK removed while imports remain

**Problem.** Uninstalling the old vendor package feels like the natural last step of a migration. The agent does not grep for call sites it missed first.

**Impact.** The build fails, or a runtime import error appears, on the missed file.

**Rule location.** [`context-mill: context/skills/migrate/references/5-cleanup.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/migrate/references/5-cleanup.md)

**Sources.** [PostHog/context-mill#142](https://github.com/PostHog/context-mill/pull/142), [PostHog/wizard#474](https://github.com/PostHog/wizard/pull/474)

**Frameworks.** `statsig`, `node`, `python`, `ruby`, `php`

**Wrong:**

```shell
pnpm remove statsig-js statsig-react
pnpm build   # fails: import { useGate } from 'statsig-react' still in Header.tsx
```

**Fixed:**

```text
# Step 5: grep for the source SDK package names first. If any import remains:
- [x] cleanup - error - Remaining source-SDK imports in <file:line>
# stop and do NOT remove the package; the report surfaces the gap
```

## Production deploy fails when PostHog is unreachable

**Problem.** The docs show the resolve step as a plain step, so the agent makes it a hard dependency with no timeout. It does not consider an outage or a CI secret that was not created yet.

**Impact.** A PostHog outage, or a CI secret that is not created yet, blocks every production deploy.

**Rule location.** [`context-mill: context/skills/error-tracking-link-releases/description.md`](https://github.com/PostHog/context-mill/blob/main/context/skills/error-tracking-link-releases/description.md) (Resolve the release in CI, Tips)

**Sources.** [PostHog/context-mill#416](https://github.com/PostHog/context-mill/pull/416)

**Frameworks.** `all`

**Wrong:**

```yaml
- name: Resolve PostHog release
  id: posthog-release
  uses: PostHog/resolve-release@v1
  with:
    api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
```

**Fixed:**

```yaml
- name: Resolve PostHog release
  id: posthog-release
  uses: PostHog/resolve-release@v1
  continue-on-error: true
  timeout-minutes: 5
# CLI form: export POSTHOG_RELEASE_ID="$(posthog-cli release resolve || true)"
# the SDK treats an empty POSTHOG_RELEASE_ID as unset
```
