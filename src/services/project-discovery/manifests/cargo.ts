/**
 * Crate versions from `Cargo.toml` dependency tables, by crate: `[dependencies]`,
 * `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]`,
 * target-specific tables, and the `[dependencies.<name>]` form. Dotted keys
 * (`sentry.workspace = true`) name their crate. A renamed dependency
 * (`alias = { package = "real" }`, `alias.package = "real"`, or a
 * `[dependencies.alias]` table with `package = "real"`) reports the real crate.
 */
export function parseCargoToml(content: string): Record<string, string> {
  // Dependency key → the crate it names, in the order keys first appear.
  const crates = new Map<string, string>();
  // Dependency key → the version it declares.
  const versions = new Map<string, string>();
  const quoted = (text: string) => /^\s*"([^"]+)"/.exec(text)?.[1];
  const add = (key: string, crate?: string): void => {
    if (crate !== undefined) crates.set(key, crate);
    else if (!crates.has(key)) crates.set(key, key);
  };
  let inDeps = false;
  // The dependency a `[dependencies.<name>]` table describes.
  let tableDep: string | null = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    // `[[bin]]` and other array tables end a dependency table too.
    const header = /^\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      const table = header[1].trim();
      const named =
        /(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/.exec(table);
      tableDep = named ? named[1] : null;
      if (tableDep) add(tableDep);
      inDeps = /(?:^|\.)(?:dev-|build-)?dependencies$/.test(table);
      continue;
    }
    if (tableDep) {
      const field = /^(package|version)\s*=(.*)$/.exec(line);
      const text = field && quoted(field[2]);
      if (text && field[1] === 'package') add(tableDep, text);
      else if (text) versions.set(tableDep, text);
      continue;
    }
    if (!inDeps) continue;
    const entry = /^([A-Za-z0-9_-]+)(\.[A-Za-z0-9_-]+)?\s*=(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, subkey, value] = entry;
    let renamed: RegExpExecArray | null = null;
    if (subkey === '.package') renamed = /^\s*"([^"]+)"/.exec(value);
    else if (!subkey) renamed = /\bpackage\s*=\s*"([^"]+)"/.exec(value);
    add(key, renamed?.[1]);
    const version =
      subkey === '.version'
        ? quoted(value)
        : !subkey
        ? quoted(value) ?? /\bversion\s*=\s*"([^"]+)"/.exec(value)?.[1]
        : undefined;
    if (version) versions.set(key, version);
  }
  return Object.fromEntries(
    [...crates].map(([key, crate]) => [crate, versions.get(key) ?? '']),
  );
}
