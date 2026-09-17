import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('../src/coupon-pilot.shell.js', import.meta.url), 'utf8');
const moduleSource = await readFile(new URL('../modules/lowes-foods.js', import.meta.url), 'utf8');
const commands = new Map();
const storage = new Map();
const observed = [];

function fakeElement(tagName = 'div') {
  const attributes = new Map();
  const classes = new Set();
  const element = {
    tagName: tagName.toUpperCase(),
    style: { setProperty() {}, removeProperty() {} },
    children: [],
    className: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    isConnected: true,
    dataset: {},
    classList: {
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    focus() {},
    click() { this.clicked = true; }
  };
  Object.defineProperty(element, 'innerHTML', { get: () => '', set() { element.children.length = 0; } });
  return element;
}

const elements = new Map();
for (const selector of ['.app','.moduleManager','.moduleList','.moduleNotice','.installModule','.moduleFile','.chips','.terms','.search','.termInput','.couponList','.activityList','.sub','.healthDot','.healthText','.found','.eligible','.blockedCount','.clippedCount','.dryRun','.delay','.maxActions','.start','.stop','.runStatus','.addTerm','.debug','.minimize','.modulesToggle']) elements.set(selector, fakeElement());
const tabs = [fakeElement('button'), fakeElement('button')];
tabs[0].dataset.tab = 'block'; tabs[1].dataset.tab = 'always';
const activeSections = Array.from({ length: 6 }, () => fakeElement());
const shadow = {
  innerHTML: '',
  querySelector: selector => elements.get(selector) || null,
  querySelectorAll: selector => selector === '.tab' ? tabs : selector === '.activeOnly' ? activeSections : []
};
const host = fakeElement();
host.attachShadow = () => shadow;
const documentElement = fakeElement('html');
const body = fakeElement('body');
const document = {
  body,
  documentElement,
  createElement: tag => tag === 'div' && !document.hostCreated ? (document.hostCreated = true, host) : fakeElement(tag),
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null
};

const context = {
  Blob,
  DOMException,
  TextEncoder,
  URL,
  console,
  confirm: () => true,
  alert: () => {},
  crypto: webcrypto,
  document,
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  innerHeight: 900,
  location: { href: 'https://shop.lowesfoods.com/shop/coupons', origin: 'https://shop.lowesfoods.com', pathname: '/shop/coupons' },
  navigator: { clipboard: { writeText: async () => {} } },
  performance,
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  GM_getValue: async (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
  GM_setValue: async (key, value) => storage.set(key, structuredClone(value)),
  GM_setClipboard: () => {},
  GM_registerMenuCommand: (name, handler) => commands.set(name, handler),
  MutationObserver: class { constructor(callback) { this.callback = callback; } observe(target) { observed.push(target); } disconnect() {} },
  window: null
};
context.window = context;
context.window.addEventListener = () => {};
context.window.scrollBy = () => {};

await vm.runInContext(shell, vm.createContext(context), { filename: 'coupon-pilot.shell.js' });
assert.equal(host.style.display, 'none', 'base shell should stay hidden with no matching installed module');
assert.ok(commands.has('Coupon Pilot: Manage modules'), 'module manager menu command is missing');

await commands.get('Coupon Pilot: Manage modules')();
assert.equal(host.style.display, '', 'module manager command should open the panel');

const file = { name: 'lowes-foods.js', size: new Blob([moduleSource]).size, text: async () => moduleSource };
await elements.get('.moduleFile').onchange({ target: { files: [file], value: 'lowes-foods.js' } });
const installed = storage.get('couponPilot:installedModules');
assert.equal(installed.length, 1, 'installed module must be persisted');
assert.equal(installed[0].id, 'lowes-foods');
assert.equal(installed[0].enabled, true);
assert.equal(installed[0].sha256.length, 64, 'installed source must receive a SHA-256 digest');
assert.match(elements.get('.sub').textContent, /^Lowes Foods/, 'installed matching module should activate without rebuilding the base');
assert.match(elements.get('.healthText').textContent, /No coupon cards detected yet/, 'installed module should execute its health check');
assert.equal(observed.at(-1), body, 'DOM observation should start only after a module matches');

let moduleRow = elements.get('.moduleList').children[0];
await moduleRow.children.at(-1).children[0].onclick();
assert.equal(storage.get('couponPilot:installedModules')[0].enabled, false, 'module disable must persist');
assert.equal(elements.get('.sub').textContent, 'Module manager', 'disabled module must stop matching immediately');

await elements.get('.moduleFile').onchange({ target: { files: [file], value: 'lowes-foods.js' } });
assert.equal(storage.get('couponPilot:installedModules')[0].enabled, false, 'updating a disabled module must keep it disabled');

moduleRow = elements.get('.moduleList').children[0];
await moduleRow.children.at(-1).children[0].onclick();
assert.equal(storage.get('couponPilot:installedModules')[0].enabled, true, 'module enable must persist');
assert.match(elements.get('.sub').textContent, /^Lowes Foods/, 're-enabled module must reactivate immediately');

moduleRow = elements.get('.moduleList').children[0];
await moduleRow.children.at(-1).children[1].onclick();
assert.equal(storage.get('couponPilot:installedModules').length, 0, 'module removal must persist');

console.log('Coupon Pilot local module manager smoke test passed.');
