import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests', workers:1, timeout:30000, use:{viewport:{width:1100,height:800}}, webServer:{command:'npm run demo -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false}});
