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
  apiVersion: 2,
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
const requiredFunctions = ['matches', 'discoverItems', 'perform', 'verify', 'healthCheck'];
const modules = new Map();

for (const file of moduleFiles) {
  const source = await readFile(new URL(`../modules/${file}`, import.meta.url), 'utf8');
  const context = vm.createContext({ window: {}, location: { hostname: '', pathname: '' } });
  vm.runInContext(source, context, { filename: file });
  assert.equal(context.window.CouponPilotModuleFactories?.length, 1, `${file} must register exactly one factory`);
  const module = context.window.CouponPilotModuleFactories[0](api);
  assert.equal(module.apiVersion, api.apiVersion, `${file} must use the current module API`);
  assert.ok(module.id && module.name, `${file} must define id and name`);
  for (const key of requiredFunctions) assert.equal(typeof module[key], 'function', `${file} is missing ${key}`);
  assert.ok(!modules.has(module.id), `duplicate module id: ${module.id}`);
  modules.set(module.id, { module, context });
}

const harrisTeeter = modules.get('harris-teeter');
assert.ok(harrisTeeter, 'Harris Teeter module missing from manifest');
harrisTeeter.context.location.hostname = 'www.harristeeter.com';
harrisTeeter.context.location.pathname = '/savings/cl/coupons/';
assert.equal(harrisTeeter.module.matches(), true, 'Harris Teeter coupon URL must match');
assert.equal(harrisTeeter.module.controlStatus(makeControl({ text: 'Clip', ariaLabel: 'Clip for coupon: Save $2 coupon' })), ITEM_STATUS.AVAILABLE);
assert.equal(harrisTeeter.module.controlStatus(makeControl({ text: 'Unclip' })), ITEM_STATUS.CLIPPED);
assert.equal(harrisTeeter.module.controlStatus(makeControl({ text: 'Add' })), ITEM_STATUS.AMBIGUOUS);

const walgreens = modules.get('walgreens');
assert.ok(walgreens, 'Walgreens module missing from manifest');
walgreens.context.location.hostname = 'www.walgreens.com';
walgreens.context.location.pathname = '/offers/offers.jsp';
assert.equal(walgreens.module.matches(), true, 'Walgreens offers URL must match');
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Clip', ariaLabel: 'Clip coupon' })), ITEM_STATUS.AVAILABLE);
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Clip rebate', ariaLabel: 'Clip rebate' })), ITEM_STATUS.AVAILABLE);
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Clipped', ariaLabel: 'Coupon clipped' })), ITEM_STATUS.CLIPPED);
assert.equal(walgreens.module.controlStatus(makeControl({ text: 'Shop' })), ITEM_STATUS.AMBIGUOUS);

console.log(`Coupon Pilot module contract checks passed for ${modules.size} modules.`);
