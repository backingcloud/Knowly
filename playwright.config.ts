import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Allow a project-local browser cache in restricted desktop environments.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('.playwright')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('.playwright');
}
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 30000,
  use: { viewport: { width: 1100, height: 800 } },
  webServer: {
    command: 'npm run demo -- --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 30000,
  },
});
