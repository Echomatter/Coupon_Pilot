import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { moduleFiles } from '../modules/manifest.mjs';

const ITEM_STATUS = Object.freeze({ AVAILABLE: 'available', CLIPPED: 'clipped', AMBIGUOUS: 'ambiguous' });
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const textOf = element => normalize(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.getAttribute?.('title'));
const makeControl = ({ text = '', ariaLabel = '', title = '', disabled = false, ariaDisabled = null } = {}) => ({
  innerText: text,
  textContent: text,
  disabled,
  isConnected: true,
  getAttribute(name) { return { 'aria-label': ariaLabel, title, 'aria-disabled': ariaDisabled }[name] ?? null; }
});
const api = Object.freeze({
  apiVersion: 3,
  ITEM_STATUS,
  normalize,
  textOf,
  visible: () => true,
  controlLabel: textOf,
  isUsableControl: control => !control.disabled && control.getAttribute('aria-disabled') !== 'true',
  hash: value => String(value),
  waitFor: async predicate => predicate(),
  safeCouponIdentity: normalize,
  summarizeHealth: items => ({ found: items.length, available: items.filter(item => item.status === ITEM_STATUS.AVAILABLE).length })
});
const requiredFunctions = ['discoverItems', 'perform', 'verify', 'healthCheck'];
const modules = new Map();

function parseManifest(source) {
  const block = source.match(/^[ \t]*\/\/ ==CouponPilotModule==[ \t]*\r?\n([\s\S]*?)^[ \t]*\/\/ ==\/CouponPilotModule==[ \t]*$/m)?.[1];
  assert.ok(block, 'module header is missing');
  const fields = new Map();
  for (const match of block.matchAll(/^[ \t]*\/\/[ \t]*@([a-z]+)[ \t]+(.+?)[ \t]*$/gmi)) {
    const key = match[1].toLowerCase();
    const values = fields.get(key) || [];
    values.push(match[2]);
    fields.set(key, values);
  }
  return { id: fields.get('id')?.[0], name: fields.get('name')?.[0], version: fields.get('version')?.[0], apiVersion: Number(fields.get('api')?.[0]), matchPatterns: fields.get('match') || [] };
}

for (const file of moduleFiles) {
  const source = await readFile(new URL(`../modules/${file}`, import.meta.url), 'utf8');
  const manifest = parseManifest(source);
  const factories = [];
  const context = vm.createContext({
    CouponPilot: Object.freeze({ register: factory => factories.push(factory) }),
    document: { querySelectorAll: () => [], querySelector: () => null, getElementById: () => null }
  });
  vm.runInContext(source, context, { filename: file });
  assert.equal(factories.length, 1, `${file} must register exactly one factory`);
  const module = factories[0](api);
  assert.equal(manifest.apiVersion, api.apiVersion, `${file} header must use the current module API`);
  assert.equal(module.apiVersion, api.apiVersion, `${file} must use the current module API`);
  assert.ok(manifest.id && manifest.name && /^\d+\.\d+\.\d+/.test(manifest.version), `${file} must define module identity and version`);
  assert.ok(manifest.matchPatterns.length, `${file} must define at least one @match`);
  for (const key of requiredFunctions) assert.equal(typeof module[key], 'function', `${file} is missing ${key}`);
  assert.ok(!modules.has(manifest.id), `duplicate module id: ${manifest.id}`);
  modules.set(manifest.id, { module, manifest, context });
}

const harrisTeeter = modules.get('harris-teeter');
assert.ok(harrisTeeter, 'Harris Teeter module missing from manifest');
assert.ok(harrisTeeter.manifest.matchPatterns.includes('https://www.harristeeter.com/savings/cl/coupons/*'), 'Harris Teeter coupon URL must match');
assert.equal(harrisTeeter.module.controlStatus(makeControl({ text: 'Clip', ariaLabel: 'Clip for coupon: Save $2 coupon' })), ITEM_STATUS.AVAILABLE);
assert.equal(harrisTeeter.module.controlStatus(makeControl({ text: 'Unclip' })), ITEM_STATUS.CLIPPED);
assert.equal(harrisTeeter.module.controlStatus(makeControl({ text: 'Add' })), ITEM_STATUS.AMBIGUOUS);

const walgreens = modules.get('walgreens');
assert.ok(walgreens, 'Walgreens module missing from manifest');
assert.ok(walgreens.manifest.matchPatterns.includes('https://www.walgreens.com/offers/*'), 'Walgreens offers URL must match');
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Clip', ariaLabel: 'Clip coupon' })), ITEM_STATUS.AVAILABLE);
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Clip rebate', ariaLabel: 'Clip rebate' })), ITEM_STATUS.AVAILABLE);
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Clipped', ariaLabel: 'Coupon clipped' })), ITEM_STATUS.CLIPPED);
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Shop' })), ITEM_STATUS.AMBIGUOUS);
assert.equal(await walgreens.module.verify('walgreens:missing', { timeout: 1 }), false, 'missing Walgreens offers must not verify from the Available filter alone');

const lowesFoods = modules.get('lowes-foods');
assert.ok(lowesFoods, 'Lowes Foods module missing from manifest');
assert.ok(lowesFoods.manifest.matchPatterns.includes('https://shop.lowesfoods.com/shop/coupons*'), 'Lowes Foods coupon URL must match');
assert.equal(lowesFoods.module.controlStatus(makeControl({ text: 'Clip!' })), ITEM_STATUS.AVAILABLE);
assert.equal(lowesFoods.module.controlStatus(makeControl({ text: 'Clip!', disabled: true })), ITEM_STATUS.AMBIGUOUS);
assert.equal(lowesFoods.module.controlStatus(makeControl({ text: 'Clipped' })), ITEM_STATUS.CLIPPED);
assert.equal(lowesFoods.module.controlStatus(makeControl({ text: 'Redeemed' })), ITEM_STATUS.CLIPPED);
assert.equal(lowesFoods.module.controlStatus(makeControl({ text: 'Add' })), ITEM_STATUS.AMBIGUOUS);
const lowesDetailsLink = { getAttribute: name => name === 'href' ? '/promotions/save-two-dollars/8835298' : null };
const lowesCard = { querySelector: selector => selector.includes('c-card__link--offer') ? lowesDetailsLink : null };
assert.equal(lowesFoods.module.itemId(lowesCard), 'lowes-foods:8835298', 'Lowes Foods must use the stable offer URL id');

console.log(`Coupon Pilot module contract checks passed for ${modules.size} modules.`);
