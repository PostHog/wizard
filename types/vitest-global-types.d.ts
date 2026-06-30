/* eslint-disable @typescript-eslint/no-explicit-any -- mock helper type
   constraints mirror vitest's own `(...args: any[]) => any` procedure shape. */
// Makes vitest's global test APIs (describe/it/expect/vi/…) ambiently available
// project-wide, matching `test.globals: true` in vitest.config.ts. Referenced
// here rather than via tsconfig `types` because the project's `typeRoots` is
// constrained and can't resolve the `vitest/globals` subpath export.
/// <reference types="vitest/globals" />

// Bridges jest's ambient mock helper types to vitest's equivalents so test
// files can keep using the bare `Mock`, `Mocked`, ... names (migrated from
// `jest.Mock`, `jest.Mocked`, ...) without a per-file import from 'vitest'.
import type {
  Mock as ViMock,
  Mocked as ViMocked,
  MockedFunction as ViMockedFunction,
  MockedClass as ViMockedClass,
  MockInstance as ViMockInstance,
} from 'vitest';

declare global {
  type Mock<
    T extends (...args: any[]) => any = (...args: any[]) => any,
  > = ViMock<T>;
  type Mocked<T> = ViMocked<T>;
  type MockedFunction<T extends (...args: any[]) => any> = ViMockedFunction<T>;
  type MockedClass<T extends abstract new (...args: any[]) => any> =
    ViMockedClass<T>;
  type MockInstance<
    T extends (...args: any[]) => any = (...args: any[]) => any,
  > = ViMockInstance<T>;
}
