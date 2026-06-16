/**
 * Edited-file tracker.
 *
 * Records the project files the agent writes or edits during a run, so a
 * program can show "here's exactly what we touched" in its outro. It
 * observes the actual Write/Edit/MultiEdit tool calls — it reflects what
 * hit disk, not what the agent claimed — which is the honest basis for the
 * transparency posture of programs like the PII Bouncer.
 *
 * Module-level state mirrors the YARA scan accumulator in yara-hooks.ts:
 * the wizard runs a single program per process, so accumulation over the
 * process lifetime is the run. `resetEditedFiles()` exists for tests.
 */

// Loose hook types, matching the SDK shapes used in yara-hooks.ts. Kept
// local so this module doesn't depend on the security scanner.
type HookInput = Record<string, unknown>;
type HookOutput = Record<string, unknown>;
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookOutput>;
interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

const editedFiles = new Set<string>();

/** Record a file the agent wrote or edited (path as the agent reported it). */
export function recordEditedFile(filePath: string): void {
  if (filePath) editedFiles.add(filePath);
}

/** Every file edited this run, de-duplicated and sorted. */
export function getEditedFiles(): string[] {
  return [...editedFiles].sort();
}

/** Reset accumulated state. For tests. */
export function resetEditedFiles(): void {
  editedFiles.clear();
}

/**
 * PostToolUse hook that records the file path of every successful
 * Write / Edit / MultiEdit. Registered alongside the YARA PostToolUse
 * hooks — observing post-execution means the edit actually happened.
 */
export function createPostToolUseEditTrackerHooks(): HookCallbackMatcher[] {
  return [
    {
      hooks: [
        (input: HookInput): Promise<HookOutput> => {
          const toolName = input.tool_name as string;
          if (
            toolName === 'Write' ||
            toolName === 'Edit' ||
            toolName === 'MultiEdit'
          ) {
            const toolInput = input.tool_input as
              | Record<string, unknown>
              | undefined;
            const filePath =
              typeof toolInput?.file_path === 'string'
                ? toolInput.file_path
                : '';
            recordEditedFile(filePath);
          }
          return Promise.resolve({});
        },
      ],
    },
  ];
}
