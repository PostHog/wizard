// The TUI core resolves `@tui/programs/index` here: the registry's signature
// and nothing else. The registry imports every program folder, so the core
// may call it but never compiles against a program's code. The core reads a
// flow through `flowOwner`, so a tool's id never falls back to the skill flow.
import type { TuiProgram } from '@tui/programs/types';

export declare function getTuiProgram(programId: string): TuiProgram;
export declare function listTuiPrograms(): readonly TuiProgram[];
