// Serves the runtime dir with its locally installed Vite/AntV dependencies and saves PNG + SVG variants.
// (title, graph, takeaway and legend are all inside the one <svg>), prints metrics JSON.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const server = await createServer({ root, configFile: false, logLevel: 'error', resolve: { alias: { '@antv/infographic': resolve(root, '../../node_modules/@antv/infographic/esm/index.js') } }, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const { port } = server.httpServer.address();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 4000, height: 3000 }, deviceScaleFactor: 2 });
  const pageError = new Promise((_, reject) => page.on('pageerror', reject));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await Promise.race([page.waitForFunction(() => window.renderReady === true, null, { timeout: 30000 }), pageError]);
  const metrics = await page.evaluate(() => window.metrics);
  for (const key of Object.keys(metrics)) {
    const sheet = page.locator('#sheet-' + key);
    await sheet.screenshot({ path: resolve(root, `sheet-${key}.png`) });
    await writeFile(resolve(root, `sheet-${key}.svg`), await sheet.locator('svg').first().evaluate((e) => e.outerHTML));
  }
  console.log(JSON.stringify(metrics));
} finally {
  await browser.close();
  await server.close();
}
