import { readFile, writeFile } from 'node:fs/promises';

const shellPath = new URL('../src/coupon-pilot.shell.js', import.meta.url);
const modulePaths = [new URL('../modules/harris-teeter.js', import.meta.url)];
const outputPath = new URL('../coupon-pilot.user.js', import.meta.url);
const normalizeNewlines = source => source.replace(/\r\n?/g, '\n');
const shell = normalizeNewlines(await readFile(shellPath, 'utf8'));
const metadataEnd = shell.indexOf('// ==/UserScript==');
if (metadataEnd < 0) throw new Error('Userscript metadata block is missing');
const headerEnd = shell.indexOf('\n', metadataEnd) + 1;
const header = shell.slice(0, headerEnd);
const body = shell.slice(headerEnd).trimStart();
const modules = await Promise.all(modulePaths.map(async path => normalizeNewlines(await readFile(path, 'utf8'))));
const output = [header.trimEnd(), '', '// GENERATED FILE: edit src/coupon-pilot.shell.js or modules/*.js, then run node scripts/build.mjs.', '', ...modules.map(source => source.trim()), '', body.trim(), ''].join('\n');
if (process.argv.includes('--check')) {
  const current = normalizeNewlines(await readFile(outputPath, 'utf8'));
  if (current !== output) throw new Error('coupon-pilot.user.js is out of date; run node scripts/build.mjs');
  console.log(`Verified coupon-pilot.user.js with ${modules.length} module(s).`);
} else {
  await writeFile(outputPath, output, 'utf8');
  console.log(`Built coupon-pilot.user.js with ${modules.length} module(s).`);
}
