// Renders app icon, Android adaptive layers, splash and favicon from assets/brand/mark.svg. Usage: npm run icons
const { chromium } = require('playwright');
const fs = require('fs');
const mark = fs.readFileSync(require('path').resolve(__dirname, '..') + '/assets/brand/mark.svg', 'utf8').replace(/<svg[^>]*>/, '').replace('</svg>', '');
const out = require('path').resolve(__dirname, '..') + '/assets/images/';
const svg = (size, { bg, scale = 1, color = '#FFFFFF', radius = 0 }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${bg ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2F5BEA"/><stop offset="1" stop-color="#1D3FB8"/></linearGradient></defs><rect width="1024" height="1024" rx="${radius}" fill="url(#g)"/>` : ''}
  <g transform="translate(${512 - 512 * scale} ${512 - 512 * scale}) scale(${scale})">${mark.replaceAll('#FFFFFF', color)}</g></svg>`;
(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const p = await b.newPage();
  const shot = async (name, size, opts) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opts)}</body></html>`);
    await p.screenshot({ path: out + name, omitBackground: true });
  };
  await shot('icon.png', 1024, { bg: true });
  await shot('android-icon-foreground.png', 1024, { scale: 0.62 });
  await shot('android-icon-monochrome.png', 1024, { scale: 0.62, color: '#000000' });
  await shot('splash-icon.png', 512, { scale: 1 });
  await shot('favicon.png', 48, { bg: true, radius: 220 });
  await shot('store-icon-512.png', 512, { bg: true });
  await b.close();
})();
