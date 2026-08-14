import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../coupon-pilot.user.js', import.meta.url), 'utf8');

const metadataVersion = source.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
const appVersion = source.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/m)?.[1];

assert.ok(metadataVersion, 'userscript metadata must declare @version');
assert.ok(appVersion, 'userscript must declare APP_VERSION');
assert.equal(metadataVersion, appVersion, '@version and APP_VERSION must stay in sync');

assert.match(source, /^\/\/ @name\s+Coupon Pilot$/m, 'userscript name changed unexpectedly');
assert.match(source, /^\/\/ @match\s+https:\/\/www\.harristeeter\.com\/\*$/m, 'Harris Teeter match is missing');
assert.match(source, /^\/\/ @grant\s+GM_getValue$/m, 'persistent userscript storage grant is missing');
assert.match(source, /^\/\/ @grant\s+GM_setValue$/m, 'persistent userscript storage grant is missing');

assert.match(source, /dryRun:\s*true/, 'fresh installs must default to Dry Run');
assert.match(source, /new AbortController\(\)/, 'live runs must remain abortable');
assert.match(source, /new MutationObserver\(/, 'lazy-loaded DOM changes must remain observable');
assert.match(source, /async verify\(/, 'site modules must verify actions after clicking');
assert.match(source, /healthCheck\(\)/, 'site modules must expose a health check');
assert.match(source, /safeCouponIdentity/, 'stable fallback coupon identity is missing');

assert.ok(!source.includes('\\badd\\b'), 'generic Add matching is forbidden: it can collide with Add to cart');
assert.ok(!source.includes('proxy rotation'), 'anti-detection behavior does not belong in Coupon Pilot');
assert.ok(!source.includes('CAPTCHA solving'), 'CAPTCHA bypass behavior does not belong in Coupon Pilot');

console.log('Coupon Pilot static safety checks passed.');
