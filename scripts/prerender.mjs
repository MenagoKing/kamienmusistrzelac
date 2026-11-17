// Writes the server-rendered page into dist/index.html so the copy and layout show before JS runs.
import fs from 'node:fs';
import { render } from '../dist-ssr/entry-server.js';

const file = new URL('../dist/index.html', import.meta.url);
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('#root not found in dist/index.html');
fs.writeFileSync(file, html.replace('<div id="root"></div>', `<div id="root">${await render()}</div>`));
fs.rmSync(new URL('../dist-ssr', import.meta.url), { recursive: true, force: true });
console.log('prerendered dist/index.html');
