// Next's documented test hook: no Google request during local acceptance builds.
// The self-hosted Thai font is also the product's normal fallback.
const path = require('node:path');
const font = path.resolve(__dirname, '../apps/admin/app/fonts/NotoSansThai-Variable.ttf').replaceAll('\\', '/').replace(/^[A-Z]:/i, '');
module.exports = new Proxy({}, { get: () => `/* thai */
@font-face { font-family: 'Google Sans'; font-style: normal; font-weight: 100 900; font-display: swap; src: url(${font}) format('truetype'); }
` });
