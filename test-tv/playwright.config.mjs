import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  testDir:'.',testMatch:'browser.spec.mjs',workers:1,
  use:{browserName:'chromium',channel:'chrome',headless:true,viewport:{width:1920,height:1080}},
  webServer:{command:'node tools/serve-tv.mjs',cwd:fileURLToPath(new URL('../',import.meta.url)),url:'http://127.0.0.1:8093',reuseExistingServer:false},
  reporter:'list',outputDir:'../test-results'
});
