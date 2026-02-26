#!/usr/bin/env bash
# scaffold.sh — Bootstrap a new Ink TUI wizard project
# Usage: bash scaffold.sh [project-name]

set -euo pipefail

PROJECT_NAME="${1:-posthog-wizard}"

echo "🎨 Scaffolding Ink TUI wizard: $PROJECT_NAME"

mkdir -p "$PROJECT_NAME/src"/{components,tabs,hooks,utils}

cd "$PROJECT_NAME"

# Initialize package.json
cat > package.json << 'EOF'
{
  "name": "posthog-wizard",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/cli.tsx",
    "build": "tsc",
    "start": "node dist/cli.js"
  }
}
EOF

# Install dependencies
echo "📦 Installing dependencies..."
npm install ink react @inkjs/ui figures
npm install -D typescript @types/react @types/node tsx

# tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
EOF

# Entry point
cat > src/cli.tsx << 'EOFTSX'
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

const { waitUntilExit } = render(<App />);
await waitUntilExit();
EOFTSX

# Root App component
cat > src/app.tsx << 'EOFTSX'
import React, { useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

const TABS = ['Setup', 'Config', 'Install', 'Verify'] as const;

export const App = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState(0);

  useInput((input, key) => {
    if (key.leftArrow) setActiveTab(i => Math.max(0, i - 1));
    if (key.rightArrow) setActiveTab(i => Math.min(TABS.length - 1, i + 1));
    if (input === 'q') exit();
  });

  const width = stdout.columns ?? 80;

  return (
    <Box flexDirection="column">
      {/* Tab bar */}
      <Box gap={1} paddingX={1}>
        {TABS.map((tab, i) => (
          <Text
            key={tab}
            bold={i === activeTab}
            color={i === activeTab ? 'cyan' : 'gray'}
          >
            {i === activeTab ? '▸' : ' '} {tab}
          </Text>
        ))}
      </Box>

      {/* Divider */}
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(Math.min(60, width - 2))}</Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          Active tab: <Text bold color="cyan">{TABS[activeTab]}</Text>
        </Text>
        <Text dimColor>Replace this with your tab content components.</Text>
      </Box>

      {/* Status bar */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>←/→ switch tabs · q quit</Text>
      </Box>
    </Box>
  );
};
EOFTSX

echo ""
echo "✅ Project scaffolded at ./$PROJECT_NAME"
echo ""
echo "  cd $PROJECT_NAME"
echo "  npm run dev"
echo ""
