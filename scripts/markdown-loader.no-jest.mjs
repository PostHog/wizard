// `pnpm try` runs from source, so it loads each `.md` import as the file's text, as the build does.
import { register } from 'node:module';

register('./markdown-hooks.no-jest.mjs', import.meta.url);
