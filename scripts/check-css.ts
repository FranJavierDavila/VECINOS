import { chromium } from 'playwright-core';
const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto('http://localhost:81/?qaengine=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForTimeout(6000);
const css = await page.evaluate(async () => {
  const urls = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => (l as HTMLLinkElement).href);
  let all = '';
  for (const u of urls) {
    try { all += await (await fetch(u)).text(); } catch {}
  }
  // también los <style> inline (HMR de Next dev inyecta <style>)
  for (const s of Array.from(document.querySelectorAll('style'))) all += s.textContent ?? '';
  return {
    links: urls.length,
    accBody: all.includes('acc-body'),
    postitAlert: all.includes('postit-alert'),
    pageflip: all.includes('pageflip-next'),
    infoScroll: all.includes('info-scroll'),
    postitPanel: all.includes('postit-panel'),
    accWiggle: all.includes('postit-alert-wiggle'),
  };
});
console.log(JSON.stringify(css, null, 1));
await browser.close();
