// The TUI core resolves `@tui/tools/index` here: the tool registry's signature
// and nothing else. The registry imports every tool folder, so the core may
// call it but never compiles against a tool's code.
import type { TuiTool } from '@tui/tools/types';

export declare function getTuiTool(id: string): TuiTool | undefined;
export declare function listTuiTools(): readonly TuiTool[];
