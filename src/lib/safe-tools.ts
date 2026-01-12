export const LINTING_TOOLS: string[] = [
  // All (general purpose)
  'codespell',
  'cspell',
  'git-diff-check',
  'gitleaks',
  'trufflehog',

  // Amazon States Language
  'asl-validator',

  // Ansible
  'ansible-lint',

  // Apex, Java
  'pmd',

  // Astro, CSS, GraphQL, GritQL, HTML, JavaScript, JSON, JSONC, JSON5, JSX, TSX, Svelte, TypeScript, Vue
  'biome',

  // AWS CloudFormation templates
  'cfn-lint',
  'cfnlint',

  // AWS CloudFormation, Azure ARM, Dockerfile, Helm, Kubernetes, Security, Terraform
  'checkov',

  // AWS CloudFormation, Azure ARM, Dockerfile, Kubernetes, Secrets, Security, Terraform, Vulnerabilities
  'trivy',

  // Azure Resource Manager (ARM)
  'test-aztemplate',

  // Bash / Shell
  'shellcheck',
  'shfmt',

  // Bazel, Starlark
  'buildifier',

  // C, C++
  'cpplint',
  'clang-format',
  'clang-tidy',
  'cmake-format',
  'iwyu',
  'pragma-once',

  // C#, Dotnet (.NET)
  'dotnet-format',

  // CircleCI Config
  'circleci',

  // Clojure
  'clj-kondo',

  // CoffeeScript
  'coffeelint',

  // Commit messages
  'commitlint',

  // Copy/paste detection
  'jscpd',

  // CSS, SCSS, Sass
  'stylelint',

  // CSS, GraphQL, HTML, JavaScript, JSON, JSONC, JSON5, JSX, TSX, Markdown, TypeScript, Vue, YAML
  'prettier',

  // Cue
  'cue-fmt',

  // Dart
  'dart',

  // Dockerfile / Docker
  'hadolint',

  // Dotenv
  'dotenv-linter',

  // EditorConfig
  'editorconfig-checker',

  // GitHub Actions
  'actionlint',
  'zizmor',

  // Go
  'gofmt',
  'gofumpt',
  'goimports',
  'gokart',
  'golangci-lint',
  'golines',

  // Go, Java, JavaScript, JSON, Python, Ruby, TypeScript, YAML
  'semgrep',

  // GoReleaser
  'goreleaser',

  // GraphQL
  'graphql-schema-linter',

  // Groovy
  'npm-groovy-lint',

  // HAML
  'haml-lint',

  // HTML
  'htmlhint',

  // HTML Templates
  'djlint',

  // Java
  'checkstyle',
  'google-java-format',

  // JavaScript, JSON, TypeScript
  'eslint',

  // Next.js
  'next lint',

  // JavaScript, JSON, Markdown, TypeScript
  'deno',

  // JavaScript, TypeScript
  'rome',

  // JSON, JSONC, JSON5
  'eslint-plugin-jsonc',
  'eslint-plugin-json',

  // JSX, TSX
  'eslint-plugin-jsx-a11y',
  'eslint-plugin-react',

  // Jupyter Notebook
  'nbqa',

  // Kotlin
  'detekt',
  'ktlint',

  // Kubernetes
  'kubeconform',
  'kube-linter',

  // LaTeX
  'chktex',

  // Lua
  'luacheck',
  'stylua',

  // Markdown
  'markdownlint',
  'markdownlint-cli2',
  'markdown-link-check',
  'markdown-table-prettify',
  'remark-lint',

  // Natural language / Prose
  'textlint',
  'vale',

  // Nix
  'nixpkgs-fmt',

  // OpenAPI
  'spectral',

  // package.json
  'sort-package-json',

  // Perl
  'perlcritic',
  'perltidy',

  // PHP
  'php-cs-fixer',
  'phpcs',
  'phpstan',
  'psalm',

  // PNG
  'oxipng',

  // PowerShell
  'psscriptanalyzer',

  // Prisma
  'prisma',

  // Protocol Buffers (Protobuf)
  'protolint',
  'buf',

  // Python
  'pylint',
  'flake8',
  'isort',
  'ruff',
  'black',
  'autopep8',
  'bandit',
  'mypy',
  'pyright',
  'sourcery',
  'yapf',

  // R
  'lintr',

  // Rego
  'opa',
  'regal',

  // Ruby
  'rubocop',
  'brakeman',
  'rufo',
  'standardrb',

  // Rust
  'clippy',
  'rustfmt',

  // Scala
  'scalafmt',

  // Security, Vulnerabilities
  'osv-scanner',

  // Security, Terraform
  'terrascan',
  'tfsec',

  // Snakemake
  'snakemake --lint',
  'snakefmt',

  // SQL
  'sqlfluff',
  'sql-formatter',
  'sqlfmt',
  'squawk',

  // SVG
  'svgo',

  // Swift
  'stringslint',
  'swiftformat',
  'swiftlint',

  // Terraform
  'tflint',
  'terraform',
  'tofu',

  // Terragrunt
  'terragrunt',

  // Textproto
  'txtpbfmt',

  // TOML
  'taplo',

  // Vue
  'eslint-plugin-vue',

  // XML
  'xmllint',

  // YAML
  'yamllint',
] as const;

export type LintingTool = (typeof LINTING_TOOLS)[number];
