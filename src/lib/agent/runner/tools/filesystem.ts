import * as fs from 'fs';
import * as path from 'path';
import fastGlob from 'fast-glob';
import { z } from 'zod';
import {
  ok,
  err,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from './types';

const MAX_READ_LINES = 2000;
const MAX_GREP_RESULTS = 200;

function resolvePath(ctx: ToolContext, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(ctx.workingDirectory, p);
}

/** Parse `input` with `schema`, returning an error ToolResult on mismatch. */
function parse<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { value: T } | { error: ToolResult } {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { error: err(`Invalid input: ${result.error.issues[0]?.message}`) };
  }
  return { value: result.data };
}

// ── Read ─────────────────────────────────────────────────────────────
const readSchema = z.object({
  file_path: z.string(),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});

export const readTool: ToolDefinition = {
  name: 'Read',
  description:
    'Read a file from the filesystem. Returns 1-indexed, line-numbered content (cat -n style). Use offset/limit for large files.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or workspace-relative path',
      },
      offset: { type: 'number', description: '1-based line to start from' },
      limit: { type: 'number', description: 'Max lines to read' },
    },
    required: ['file_path'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = parse(readSchema, input);
    if ('error' in parsed) return Promise.resolve(parsed.error);
    const { file_path, offset = 1, limit = MAX_READ_LINES } = parsed.value;
    try {
      const abs = resolvePath(ctx, file_path);
      const lines = fs.readFileSync(abs, 'utf-8').split('\n');
      const start = offset - 1;
      const slice = lines.slice(start, start + limit);
      const numbered = slice
        .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
        .join('\n');
      return Promise.resolve(ok(numbered));
    } catch (e) {
      return Promise.resolve(err(fsError(e, file_path)));
    }
  },
};

// ── Write ────────────────────────────────────────────────────────────
const writeSchema = z.object({ file_path: z.string(), content: z.string() });

export const writeTool: ToolDefinition = {
  name: 'Write',
  description:
    'Write content to a file, creating parent directories and overwriting any existing file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['file_path', 'content'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = parse(writeSchema, input);
    if ('error' in parsed) return Promise.resolve(parsed.error);
    const { file_path, content } = parsed.value;
    try {
      const abs = resolvePath(ctx, file_path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
      return Promise.resolve(
        ok(`Wrote ${Buffer.byteLength(content)} bytes to ${file_path}`),
      );
    } catch (e) {
      return Promise.resolve(err(fsError(e, file_path)));
    }
  },
};

// ── Edit ─────────────────────────────────────────────────────────────
const editSchema = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export const editTool: ToolDefinition = {
  name: 'Edit',
  description:
    'Replace an exact string in a file. Fails if old_string is absent, or non-unique unless replace_all is set.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  handler(input, ctx): Promise<ToolResult> {
    const parsed = parse(editSchema, input);
    if ('error' in parsed) return Promise.resolve(parsed.error);
    const { file_path, old_string, new_string, replace_all } = parsed.value;
    try {
      const abs = resolvePath(ctx, file_path);
      const original = fs.readFileSync(abs, 'utf-8');
      if (old_string === new_string) {
        return Promise.resolve(err('old_string and new_string are identical'));
      }
      const occurrences = original.split(old_string).length - 1;
      if (occurrences === 0) {
        return Promise.resolve(err('old_string not found in file'));
      }
      if (occurrences > 1 && !replace_all) {
        return Promise.resolve(
          err(
            `old_string is not unique (${occurrences} matches); pass replace_all or add context`,
          ),
        );
      }
      const updated = replace_all
        ? original.split(old_string).join(new_string)
        : original.replace(old_string, new_string);
      fs.writeFileSync(abs, updated, 'utf-8');
      return Promise.resolve(
        ok(
          `Edited ${file_path} (${
            replace_all ? occurrences : 1
          } replacement(s))`,
        ),
      );
    } catch (e) {
      return Promise.resolve(err(fsError(e, file_path)));
    }
  },
};

// ── Glob ─────────────────────────────────────────────────────────────
const globSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

export const globTool: ToolDefinition = {
  name: 'Glob',
  description:
    'Find files matching a glob pattern, newest first (by modification time).',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: {
        type: 'string',
        description: 'Directory to search (defaults to workspace)',
      },
    },
    required: ['pattern'],
  },
  async handler(input, ctx): Promise<ToolResult> {
    const parsed = parse(globSchema, input);
    if ('error' in parsed) return parsed.error;
    const { pattern } = parsed.value;
    const cwd = parsed.value.path
      ? resolvePath(ctx, parsed.value.path)
      : ctx.workingDirectory;
    try {
      const matches = await fastGlob(pattern, {
        cwd,
        absolute: true,
        dot: false,
        onlyFiles: true,
        suppressErrors: true,
      });
      const sorted = matches
        .map((file) => ({ file, mtime: safeMtime(file) }))
        .sort((a, b) => b.mtime - a.mtime)
        .map((m) => m.file);
      return sorted.length ? ok(sorted.join('\n')) : ok('No files found');
    } catch (e) {
      return err(fsError(e, pattern));
    }
  },
};

// ── Grep ─────────────────────────────────────────────────────────────
const grepSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  output_mode: z.enum(['files_with_matches', 'content']).optional(),
  '-i': z.boolean().optional(),
});

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description:
    'Search file contents with a regular expression. output_mode "files_with_matches" (default) lists files; "content" lists matching lines as file:line:text.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression' },
      path: { type: 'string' },
      glob: {
        type: 'string',
        description: 'Filter files by glob (e.g. "*.ts")',
      },
      output_mode: { type: 'string', enum: ['files_with_matches', 'content'] },
      '-i': { type: 'boolean', description: 'Case-insensitive' },
    },
    required: ['pattern'],
  },
  async handler(input, ctx): Promise<ToolResult> {
    const parsed = parse(grepSchema, input);
    if ('error' in parsed) return parsed.error;
    const { pattern, glob, output_mode = 'files_with_matches' } = parsed.value;
    const root = parsed.value.path
      ? resolvePath(ctx, parsed.value.path)
      : ctx.workingDirectory;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, parsed.value['-i'] ? 'i' : undefined);
    } catch (e) {
      return err(
        `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      const files = await fastGlob(glob ?? '**/*', {
        cwd: root,
        absolute: true,
        dot: false,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        suppressErrors: true,
      });
      const matchedFiles: string[] = [];
      const contentLines: string[] = [];
      for (const file of files) {
        let text: string;
        try {
          text = fs.readFileSync(file, 'utf-8');
        } catch {
          continue; // unreadable/binary — skip
        }
        const fileLines = text.split('\n');
        let fileMatched = false;
        for (let i = 0; i < fileLines.length; i++) {
          if (regex.test(fileLines[i])) {
            fileMatched = true;
            if (output_mode === 'content') {
              contentLines.push(`${file}:${i + 1}:${fileLines[i]}`);
              if (contentLines.length >= MAX_GREP_RESULTS) break;
            } else {
              break;
            }
          }
        }
        if (fileMatched && output_mode === 'files_with_matches') {
          matchedFiles.push(file);
        }
        if (
          (output_mode === 'content' &&
            contentLines.length >= MAX_GREP_RESULTS) ||
          (output_mode === 'files_with_matches' &&
            matchedFiles.length >= MAX_GREP_RESULTS)
        ) {
          break;
        }
      }
      const out = output_mode === 'content' ? contentLines : matchedFiles;
      return out.length ? ok(out.join('\n')) : ok('No matches found');
    } catch (e) {
      return err(fsError(e, pattern));
    }
  },
};

function safeMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function fsError(e: unknown, target: string): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return `File not found: ${target}`;
  if (code === 'EISDIR') return `Path is a directory: ${target}`;
  return `Error accessing ${target}: ${
    e instanceof Error ? e.message : String(e)
  }`;
}
