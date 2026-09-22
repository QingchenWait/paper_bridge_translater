import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === 'win32' && existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined);
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    viewport: { width: 1600, height: 1000 },
    launchOptions: { ...(chrome ? { executablePath: chrome } : {}) },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
