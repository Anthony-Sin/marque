// Pull ALL cookies from a CDP browser (port argv[2], default 9222) -> /tmp/cdp_cookies_<port>.json
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire('/home/ANT/mllab/scripts/x.js');
const pw = require('playwright-core');
const port = process.argv[2] || '9222';
const b = await pw.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const cookies = await b.contexts()[0].cookies();
writeFileSync(`/tmp/cdp_cookies_${port}.json`, JSON.stringify(cookies));
console.log('ok', cookies.length);
process.exit(0);
