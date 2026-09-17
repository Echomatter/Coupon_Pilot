// ==UserScript==
// @name         Coupon Pilot
// @namespace    https://github.com/Echomatter/Coupon_Pilot
// @version      0.6.0
// @description  Coupon automation shell with locally installable retailer modules.
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// ==/UserScript==

// GENERATED BASE SCRIPT: edit src/coupon-pilot.shell.js, then run node scripts/build.mjs.
// Retailer modules are installed separately from local .js files.

(async function CouponPilot() {
  'use strict';

  const APP_VERSION = '0.6.0';
  const MODULE_API_VERSION = 3;
  const ITEM_STATUS = Object.freeze({ AVAILABLE: 'available', CLIPPED: 'clipped', AMBIGUOUS: 'ambiguous' });
  const VALID_ITEM_STATUSES = new Set(Object.values(ITEM_STATUS));
  const STORAGE_KEY = 'couponPilot:state';
  const INSTALLED_MODULES_KEY = 'couponPilot:installedModules';
  const MAX_MODULE_SOURCE_BYTES = 512 * 1024;
  const PREVIEW_ATTR = 'data-coupon-pilot-preview';
  const DEFAULT_BLOCKED_GROUPS = Object.freeze({
    Baby: Object.freeze(['baby', 'diaper', 'diapers', 'formula', 'infant', 'toddler']),
    Pet: Object.freeze(['dog food', 'cat food', 'dog treat', 'cat treat', 'pet treat', 'litter']),
    Beauty: Object.freeze(['makeup', 'cosmetic', 'mascara', 'foundation', 'hair color']),
    Supplements: Object.freeze(['vitamin', 'supplement', 'probiotic']),
    Household: Object.freeze(['laundry', 'detergent', 'dishwasher', 'trash bag', 'air freshener'])
  });

  const DEFAULT_STATE = {
    minimized: false,
    automation: {
      clickDelay: 550,
      scrollDelay: 900,
      verifyTimeout: 4500,
      maxActions: 300,
      maxConsecutiveFailures: 5,
      retryAttempts: 2,
      dryRun: true
    },
    rules: { blockedTerms: [], alwaysTerms: [], enabledGroups: {} },
    modules: {}
  };

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const textOf = element => normalize(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.getAttribute?.('title'));
  const visible = element => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const hash = input => {
    let value = 2166136261;
    for (const ch of String(input)) { value ^= ch.charCodeAt(0); value = Math.imul(value, 16777619); }
    return (value >>> 0).toString(36);
  };
  async function waitFor(predicate, { timeout = 4000, interval = 150, signal } = {}) {
    const started = performance.now();
    while (performance.now() - started < timeout) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const result = await predicate();
      if (result) return result;
      await sleep(interval, signal);
    }
    return false;
  }
  function safeCouponIdentity(text) {
    return normalize(text).toLowerCase().replace(/\b(clipped|unclip|remove coupon|clip coupon|clip)\b/g, '').replace(/\s+/g, ' ').trim();
  }
  function controlLabel(element) {
    return normalize([textOf(element), element?.getAttribute?.('aria-label'), element?.getAttribute?.('title')].filter(Boolean).join(' '));
  }
  function isUsableControl(element) {
    return visible(element) && !element.disabled && element.getAttribute?.('aria-disabled') !== 'true';
  }
  function summarizeHealth(items) {
    const available = items.filter(item => item.status === ITEM_STATUS.AVAILABLE).length;
    const clipped = items.filter(item => item.status === ITEM_STATUS.CLIPPED).length;
    const ambiguous = items.filter(item => item.status === ITEM_STATUS.AMBIGUOUS).length;
    if (!items.length) return { level: 'warning', message: 'No coupon cards detected yet', found: 0, available: 0, clipped: 0, ambiguous: 0 };
    if (!available && clipped && !ambiguous) return { level: 'done', message: 'No unclipped coupons currently detected', found: items.length, available, clipped, ambiguous };
    if (ambiguous) return { level: available ? 'caution' : 'warning', message: available ? `${available} ready · ${ambiguous} skipped as ambiguous` : `${ambiguous} ambiguous coupon controls detected`, found: items.length, available, clipped, ambiguous };
    return { level: 'ready', message: `${available} ready to clip`, found: items.length, available, clipped, ambiguous };
  }
  function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }
  function uniqueTerms(terms) { return [...new Set((Array.isArray(terms) ? terms : []).map(term => normalize(term).toLowerCase()).filter(Boolean))]; }
  function migrateState(stored) {
    const storedAutomation = stored?.automation && typeof stored.automation === 'object' && !Array.isArray(stored.automation) ? stored.automation : {};
    const storedModules = stored?.modules && typeof stored.modules === 'object' && !Array.isArray(stored.modules) ? stored.modules : {};
    const storedRules = stored?.rules && typeof stored.rules === 'object' && !Array.isArray(stored.rules) ? stored.rules : {};
    const legacyModuleRules = Object.values(storedModules).filter(value => value && typeof value === 'object');
    const mergedTerms = key => uniqueTerms([...(Array.isArray(storedRules[key]) ? storedRules[key] : []), ...legacyModuleRules.flatMap(value => Array.isArray(value[key]) ? value[key] : [])]);
    const enabledGroups = { ...(storedRules.enabledGroups && typeof storedRules.enabledGroups === 'object' && !Array.isArray(storedRules.enabledGroups) ? storedRules.enabledGroups : {}) };
    for (const moduleState of legacyModuleRules) for (const [name, enabled] of Object.entries(moduleState.enabledGroups || {})) if (enabled) enabledGroups[name] = true;
    for (const name of Object.keys(DEFAULT_BLOCKED_GROUPS)) enabledGroups[name] = Boolean(enabledGroups[name]);
    return {
      minimized: Boolean(stored?.minimized),
      automation: {
        clickDelay: clampNumber(storedAutomation.clickDelay, DEFAULT_STATE.automation.clickDelay, 250, 5000),
        scrollDelay: clampNumber(storedAutomation.scrollDelay, DEFAULT_STATE.automation.scrollDelay, 100, 10000),
        verifyTimeout: clampNumber(storedAutomation.verifyTimeout, DEFAULT_STATE.automation.verifyTimeout, 500, 30000),
        maxActions: Math.floor(clampNumber(storedAutomation.maxActions, DEFAULT_STATE.automation.maxActions, 1, 1000)),
        maxConsecutiveFailures: Math.floor(clampNumber(storedAutomation.maxConsecutiveFailures, DEFAULT_STATE.automation.maxConsecutiveFailures, 1, 50)),
        retryAttempts: Math.floor(clampNumber(storedAutomation.retryAttempts, DEFAULT_STATE.automation.retryAttempts, 1, 10)),
        dryRun: typeof storedAutomation.dryRun === 'boolean' ? storedAutomation.dryRun : DEFAULT_STATE.automation.dryRun
      },
      rules: { blockedTerms: mergedTerms('blockedTerms'), alwaysTerms: mergedTerms('alwaysTerms'), enabledGroups },
      modules: storedModules
    };
  }

  function migrateInstalledModules(stored) {
    if (!Array.isArray(stored)) return [];
    return stored.filter(record => record && typeof record.source === 'string').map(record => {
      const fileName = typeof record.fileName === 'string' ? record.fileName : 'local-module.js';
      return {
        id: typeof record.id === 'string' && record.id ? record.id : fileName,
        source: record.source,
        fileName,
        installedAt: typeof record.installedAt === 'string' ? record.installedAt : null,
        sha256: typeof record.sha256 === 'string' ? record.sha256 : null,
        enabled: record.enabled !== false
      };
    });
  }

  function parseModuleManifest(source) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('The selected module is empty');
    if (new Blob([source]).size > MAX_MODULE_SOURCE_BYTES) throw new Error('Module is larger than the 512 KB safety limit');
    const block = source.match(/^[ \t]*\/\/ ==CouponPilotModule==[ \t]*\r?\n([\s\S]*?)^[ \t]*\/\/ ==\/CouponPilotModule==[ \t]*$/m)?.[1];
    if (!block) throw new Error('Missing Coupon Pilot module header');
    const fields = new Map();
    for (const match of block.matchAll(/^[ \t]*\/\/[ \t]*@([a-z]+)[ \t]+(.+?)[ \t]*$/gmi)) {
      const key = match[1].toLowerCase();
      const values = fields.get(key) || [];
      values.push(match[2]);
      fields.set(key, values);
    }
    const one = key => fields.get(key)?.[0]?.trim() || '';
    const id = one('id');
    const name = one('name');
    const version = one('version');
    const apiVersion = Number(one('api'));
    const description = one('description');
    const matchPatterns = (fields.get('match') || []).map(value => value.trim()).filter(Boolean);
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new Error('Module @id must use 2–64 lowercase letters, numbers, or hyphens');
    if (!name || name.length > 80) throw new Error('Module @name is missing or too long');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Module @version must use semantic versioning, such as 1.0.0');
    if (apiVersion !== MODULE_API_VERSION) throw new Error(`Module requires API ${one('api') || 'missing'}; this shell supports API ${MODULE_API_VERSION}`);
    if (!matchPatterns.length || matchPatterns.some(pattern => !/^https?:\/\/[^/\s]+\/\S*$/i.test(pattern))) throw new Error('Module needs at least one valid http(s) @match pattern');
    return Object.freeze({ id, name, version, apiVersion, description: description.slice(0, 160), matchPatterns: Object.freeze(matchPatterns) });
  }

  function urlMatchesPattern(pattern, url = location.href) {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
    try { return new RegExp(`^${escaped}$`, 'i').test(url); }
    catch { return false; }
  }

  const requiredFunctions = ['discoverItems', 'perform', 'verify', 'healthCheck'];
  function validateModuleAdapter(adapter, manifest) {
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) throw new Error(`${manifest.id} factory did not return a module object`);
    if (adapter.apiVersion !== MODULE_API_VERSION) throw new Error(`${manifest.id} returned unsupported API ${adapter.apiVersion ?? 'missing'}`);
    for (const key of requiredFunctions) if (typeof adapter[key] !== 'function') throw new Error(`${manifest.id}: ${key} must be a function`);
    if (adapter.findLoadMore != null && typeof adapter.findLoadMore !== 'function') throw new Error(`${manifest.id}: findLoadMore must be a function when provided`);
    if (adapter.defaultBlockedGroups != null) {
      if (typeof adapter.defaultBlockedGroups !== 'object' || Array.isArray(adapter.defaultBlockedGroups)) throw new Error(`${manifest.id}: invalid defaultBlockedGroups`);
      for (const [groupName, terms] of Object.entries(adapter.defaultBlockedGroups)) {
        if (!groupName.trim() || !Array.isArray(terms) || terms.some(term => typeof term !== 'string')) throw new Error(`${manifest.id}: invalid blocked group ${groupName || 'missing'}`);
      }
    }
    return Object.freeze({ ...adapter, ...manifest, manifest });
  }

  const moduleApi = Object.freeze({ apiVersion: MODULE_API_VERSION, ITEM_STATUS, normalize, textOf, visible, controlLabel, isUsableControl, hash, waitFor, safeCouponIdentity, summarizeHealth });
  function instantiateModule(source, fileName = 'local-module.js') {
    const manifest = parseModuleManifest(source);
    const factories = [];
    const CouponPilot = Object.freeze({
      register(factory) {
        if (typeof factory !== 'function') throw new Error(`${manifest.id}: CouponPilot.register expects a factory function`);
        factories.push(factory);
      }
    });
    const safeName = normalize(fileName).replace(/[^a-z0-9._-]/gi, '-').slice(0, 100) || `${manifest.id}.js`;
    // eslint-disable-next-line no-new-func
    Function('CouponPilot', `'use strict';\n${source}\n//# sourceURL=coupon-pilot-module-${safeName}`)(CouponPilot);
    if (factories.length !== 1) throw new Error(`${manifest.id} must call CouponPilot.register exactly once`);
    return validateModuleAdapter(factories[0](moduleApi), manifest);
  }

  let state = migrateState(await GM_getValue(STORAGE_KEY, DEFAULT_STATE));
  let installedModuleRecords = migrateInstalledModules(await GM_getValue(INSTALLED_MODULES_KEY, []));
  const persist = () => GM_setValue(STORAGE_KEY, state);
  const persistInstalledModules = () => GM_setValue(INSTALLED_MODULES_KEY, installedModuleRecords);
  const modules = [];
  const moduleLoadErrors = [];

  function reloadInstalledModules() {
    modules.length = 0;
    moduleLoadErrors.length = 0;
    const seen = new Set();
    for (const record of installedModuleRecords) {
      try {
        const manifest = parseModuleManifest(record.source);
        record.id = manifest.id;
        if (seen.has(manifest.id)) throw new Error(`Duplicate installed module id: ${manifest.id}`);
        seen.add(manifest.id);
        if (record.enabled !== false) modules.push(instantiateModule(record.source, record.fileName));
      } catch (error) {
        moduleLoadErrors.push({ id: record.id || record.fileName, message: error?.message || String(error) });
        console.warn('[Coupon Pilot] module load failed', record.fileName, error);
      }
    }
  }
  reloadInstalledModules();

  async function sha256(source) {
    if (typeof crypto === 'undefined' || !crypto.subtle) return `fnv1a-${hash(source)}`;
    const bytes = new TextEncoder().encode(source);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function installModuleFile(file) {
    if (running) throw new Error('Stop the current run before changing modules');
    if (!file || !/\.js$/i.test(file.name)) throw new Error('Choose a JavaScript (.js) module file');
    if (file.size > MAX_MODULE_SOURCE_BYTES) throw new Error('Module is larger than the 512 KB safety limit');
    const source = await file.text();
    const manifest = parseModuleManifest(source);
    const existing = installedModuleRecords.find(record => record.id === manifest.id);
    const action = existing ? 'Update' : 'Install';
    const approved = confirm(`${action} ${manifest.name} v${manifest.version}?\n\nLocal modules are trusted JavaScript. They can read and interact with pages where Coupon Pilot runs. Only install files you trust.`);
    if (!approved) return false;
    instantiateModule(source, file.name);
    const record = { id: manifest.id, source, fileName: file.name, installedAt: new Date().toISOString(), sha256: await sha256(source), enabled: existing ? existing.enabled !== false : true };
    const index = installedModuleRecords.findIndex(candidate => candidate.id === manifest.id);
    if (index >= 0) installedModuleRecords[index] = record;
    else installedModuleRecords.push(record);
    await persistInstalledModules();
    reloadInstalledModules();
    managerMessage = `${manifest.name} v${manifest.version} ${existing ? 'updated' : 'installed'}.`;
    managerOpen = true;
    refreshData();
    return true;
  }

  async function setModuleEnabled(id, enabled) {
    if (running) return;
    const record = installedModuleRecords.find(candidate => candidate.id === id);
    if (!record) return;
    record.enabled = enabled;
    await persistInstalledModules();
    reloadInstalledModules();
    managerMessage = `${id} ${enabled ? 'enabled' : 'disabled'}.`;
    refreshData();
  }

  async function removeInstalledModule(id) {
    if (running) return;
    const record = installedModuleRecords.find(candidate => candidate.id === id);
    if (!record || !confirm(`Remove the ${id} module?\n\nCoupon rules and run history for this retailer will be kept.`)) return;
    installedModuleRecords = installedModuleRecords.filter(candidate => candidate !== record);
    await persistInstalledModules();
    reloadInstalledModules();
    managerMessage = `${id} removed.`;
    refreshData();
  }

  function discoverModuleItems(module) {
    const items = module.discoverItems();
    if (!Array.isArray(items)) throw new Error(`${module.id} discoverItems must return an array`);
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') throw new Error(`${module.id} returned an invalid item`);
      if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) throw new Error(`${module.id} returned a missing or duplicate item id`);
      if (typeof item.text !== 'string' || typeof item.title !== 'string') throw new Error(`${module.id} item ${item.id} is missing text or title`);
      if (!VALID_ITEM_STATUSES.has(item.status)) throw new Error(`${module.id} item ${item.id} has invalid status ${item.status}`);
      seen.add(item.id);
    }
    return items;
  }

  const getMatchingModules = () => modules.filter(module => module.matchPatterns.some(pattern => urlMatchesPattern(pattern)));
  function getActiveModule() {
    const matching = getMatchingModules();
    return matching.length === 1 ? matching[0] : null;
  }

  function getModuleState(module) {
    if (!state.modules[module.id] || typeof state.modules[module.id] !== 'object' || Array.isArray(state.modules[module.id])) {
      state.modules[module.id] = { blockedTerms: [], alwaysTerms: [], enabledGroups: {}, lastRun: null };
    }
    const moduleState = state.modules[module.id];
    return moduleState;
  }

  function getSharedRules() {
    if (!state.rules || typeof state.rules !== 'object') state.rules = { blockedTerms: [], alwaysTerms: [], enabledGroups: {} };
    if (!Array.isArray(state.rules.blockedTerms)) state.rules.blockedTerms = [];
    if (!Array.isArray(state.rules.alwaysTerms)) state.rules.alwaysTerms = [];
    if (!state.rules.enabledGroups || typeof state.rules.enabledGroups !== 'object' || Array.isArray(state.rules.enabledGroups)) state.rules.enabledGroups = {};
    for (const name of Object.keys(DEFAULT_BLOCKED_GROUPS)) if (!(name in state.rules.enabledGroups)) state.rules.enabledGroups[name] = false;
    return state.rules;
  }
  function urlSearchText(value) {
    if (!value) return '';
    try { const url = new URL(value, location.href); return decodeURIComponent(`${url.hostname} ${url.pathname} ${url.search}`).replace(/[-_+/=%&?.]+/g, ' '); }
    catch { return String(value).replace(/[-_+/=%&?.]+/g, ' '); }
  }
  function itemSearchText(item) {
    const element = item.element;
    const links = element?.querySelectorAll ? [...element.querySelectorAll('a[href]')].slice(0, 12) : [];
    const images = element?.querySelectorAll ? [...element.querySelectorAll('img[alt]')].slice(0, 8) : [];
    const metadata = item.metadata && typeof item.metadata === 'object' ? Object.values(item.metadata) : [];
    return normalize([
      item.text, item.title, item.url, item.productUrl, ...metadata,
      ...links.flatMap(link => [urlSearchText(link.getAttribute('href')), link.getAttribute('aria-label'), link.getAttribute('title')]),
      ...images.map(image => image.getAttribute('alt')),
      element?.getAttribute?.('aria-label'), element?.getAttribute?.('title')
    ].filter(Boolean).join(' ')).toLowerCase();
  }
  function evaluateRules(item, module) {
    const haystack = itemSearchText(item);
    const rules = getSharedRules();
    const always = uniqueTerms(rules.alwaysTerms).find(term => haystack.includes(term));
    if (always) return { eligible: true, reason: `always: ${always}` };
    const blocked = [...rules.blockedTerms];
    for (const [groupName, terms] of Object.entries(DEFAULT_BLOCKED_GROUPS)) if (rules.enabledGroups[groupName]) blocked.push(...terms);
    const match = uniqueTerms(blocked).find(term => haystack.includes(term));
    return match ? { eligible: false, reason: match } : { eligible: true, reason: null };
  }
  const classify = (items, module) => items.map(item => ({ ...item, decision: evaluateRules(item, module) }));

  let activeModule = null, snapshot = [], health = null, controller = null, running = false, runStatus = 'idle', refreshTimer = null, lastUrl = location.href, activeRuleTab = 'block';
  let managerOpen = false;
  let managerMessage = installedModuleRecords.length ? '' : 'Install a local retailer module to get started.';
  let pageObserver = null;
  const runStats = { acted: 0, blocked: 0, failed: 0, previewed: 0 };
  const activity = [];
  const previewOriginalStyles = new WeakMap();

  const host = document.createElement('div');
  host.id = 'coupon-pilot-host';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:none;max-width:calc(100vw - 24px)';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box}button,input{font:inherit}.hidden{display:none!important}
    .app{width:min(410px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;color:#eef2ff;background:#101522;border:1px solid #ffffff1c;border-radius:18px;box-shadow:0 24px 70px #0007;font:13px/1.35 system-ui,sans-serif}
    .app.minimized .body,.app.minimized .footer,.app.minimized .health{display:none}
    .header,.health,.section,.footer{padding:12px 14px}.header,.health,.footer,.moduleHead,.moduleActions{display:flex;align-items:center;gap:8px}.header,.health,.section{border-bottom:1px solid #ffffff12}
    .title{font-weight:800;flex:1}.sub,.health,.meta,.empty,.moduleNotice{color:#94a3b8;font-size:11px}.header .sub{max-width:145px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sectionTitle{font-size:10px;font-weight:800;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.stat{padding:8px;background:#ffffff09;border-radius:10px}.value{font-size:16px;font-weight:800}
    .chips,.terms{display:flex;flex-wrap:wrap;gap:6px}.chip,.tab,.ghost,.primary,.danger,.icon{border:0;border-radius:9px;cursor:pointer}.chip,.tab,.ghost,.icon{background:#ffffff10;color:#cbd5e1}.chip.on{background:#6d28d933;color:white}.chip{padding:6px 9px}.tabs{display:flex;gap:6px;margin-bottom:8px}.tab{padding:6px 9px}.tab.active{background:#4f46e555;color:white}
    .row{display:flex;gap:7px}.row input,.search{width:100%;padding:8px 10px;background:#ffffff0a;border:1px solid #ffffff18;border-radius:9px;color:white}.term{padding:5px 8px;border-radius:8px;background:#ffffff0a}.coupon,.activity{padding:7px 0;border-bottom:1px solid #ffffff0d}.blocked{color:#fca5a5}.clipped{color:#86efac}
    .moduleManager{background:#161d2d}.moduleRow{padding:9px 0;border-bottom:1px solid #ffffff0d}.moduleHead strong{flex:1}.moduleActions{margin-top:7px}.moduleActions .ghost{padding:6px 9px}.moduleStatus{font-size:10px;color:#94a3b8}.moduleNotice{margin:7px 0}.installModule{width:100%;padding:9px}.removeModule{color:#fca5a5}
    .footer{position:sticky;bottom:0;background:#101522}.primary,.danger{padding:10px 12px;color:white}.primary{background:#4f46e5;flex:1}.danger{background:#7f1d1d}.icon{padding:6px 9px}.healthDot{width:8px;height:8px;border-radius:50%;background:#64748b}.healthDot.ready{background:#34d399}.healthDot.caution{background:#fbbf24}.healthDot.warning{background:#f97316}.healthDot.done{background:#60a5fa}
  </style>
  <div class="app">
    <div class="header"><strong class="title">Coupon Pilot</strong><span class="sub"></span><button class="icon modulesToggle" title="Manage modules">Modules</button><button class="icon minimize">−</button></div>
    <div class="health"><span class="healthDot"></span><span class="healthText">Inspecting page</span><span class="sub">v${APP_VERSION}</span></div>
    <div class="body">
      <div class="section moduleManager hidden"><div class="sectionTitle">Installed modules</div><div class="moduleList"></div><div class="moduleNotice"></div><button class="ghost installModule">Browse for local module…</button><input class="moduleFile" type="file" accept=".js,text/javascript" hidden><div class="meta" style="margin-top:8px">Modules are trusted JavaScript stored locally in Tampermonkey.</div></div>
      <div class="section activeOnly"><input class="search" placeholder="Search loaded coupons…"></div>
      <div class="section activeOnly"><div class="stats"><div class="stat"><div class="value found">0</div><div class="meta">Found</div></div><div class="stat"><div class="value eligible">0</div><div class="meta">Eligible</div></div><div class="stat"><div class="value blockedCount">0</div><div class="meta">Blocked</div></div><div class="stat"><div class="value clippedCount">0</div><div class="meta">Clipped</div></div></div></div>
      <div class="section activeOnly"><div class="sectionTitle">Shared quick exclusions</div><div class="chips"></div></div>
      <div class="section activeOnly"><div class="sectionTitle">Shared keyword rules</div><div class="tabs"><button class="tab active" data-tab="block">Never clip</button><button class="tab" data-tab="always">Always clip</button></div><div class="row"><input class="termInput" placeholder="e.g. formula"><button class="ghost addTerm">Add</button></div><div class="terms"></div></div>
      <div class="section activeOnly"><label><input class="dryRun" type="checkbox"> Dry run</label> · <label>Delay <input class="delay" type="number" min="250" max="5000" style="width:72px"></label> · <label>Max <input class="maxActions" type="number" min="1" max="1000" style="width:72px"></label></div>
      <div class="section activeOnly"><div class="sectionTitle">Loaded coupons</div><div class="couponList"></div></div>
      <div class="section"><div class="sectionTitle">Activity · <span class="runStatus">Idle</span></div><div class="activityList"></div></div>
    </div>
    <div class="footer"><button class="icon debug" aria-label="Copy debug report" title="Copy debug report">🐞</button><button class="primary start">Run dry preview</button><button class="danger stop" disabled>Stop</button></div>
  </div>`;

  const $ = selector => shadow.querySelector(selector);
  const $$ = selector => [...shadow.querySelectorAll(selector)];
  const app = $('.app');

  function logActivity(message, level = 'info') { activity.unshift({ message, level, at: new Date() }); activity.splice(20); renderActivity(); }
  function createDebugReport() {
    const sharedRules = getSharedRules();
    const counts = { available: 0, clipped: 0, ambiguous: 0 };
    for (const item of snapshot) counts[item.status] = (counts[item.status] || 0) + 1;
    return {
      app: 'Coupon Pilot',
      version: APP_VERSION,
      capturedAt: new Date().toISOString(),
      page: activeModule ? `${location.origin}${location.pathname}` : location.origin,
      module: activeModule ? { id: activeModule.id, name: activeModule.name, version: activeModule.version, apiVersion: activeModule.apiVersion } : null,
      installedModules: installedModuleRecords.map(record => ({ id: record.id, enabled: record.enabled !== false, sha256: record.sha256 })),
      moduleLoadErrors: moduleLoadErrors.map(error => ({ id: /^[a-z][a-z0-9-]{1,63}$/.test(error.id) ? error.id : null, message: error.message })),
      health,
      items: { total: snapshot.length, ...counts },
      automation: {
        dryRun: Boolean(state.automation.dryRun),
        clickDelay: state.automation.clickDelay,
        verifyTimeout: state.automation.verifyTimeout,
        maxActions: state.automation.maxActions,
        retryAttempts: state.automation.retryAttempts
      },
      rules: {
        scope: 'shared',
        blockedTermCount: sharedRules.blockedTerms.length,
        alwaysTermCount: sharedRules.alwaysTerms.length,
        enabledGroups: Object.entries(sharedRules.enabledGroups).filter(([, enabled]) => enabled).map(([name]) => name)
      },
      ambiguousSamples: snapshot.filter(item => item.status === 'ambiguous').slice(0, 15).map(item => ({
        id: hash(item.id),
        controlText: normalize(item.control?.innerText || item.control?.textContent).slice(0, 120),
        ariaLabel: normalize(item.control?.getAttribute?.('aria-label')).slice(0, 180),
        testId: item.control?.getAttribute?.('data-testid') || null,
        disabled: Boolean(item.control?.disabled),
        ariaDisabled: item.control?.getAttribute?.('aria-disabled') || null
      }))
    };
  }
  async function copyDebugReport() {
    const report = JSON.stringify(createDebugReport(), null, 2);
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(report, 'text');
      else await navigator.clipboard.writeText(report);
      logActivity('Debug report copied to clipboard', 'success');
    } catch (error) {
      console.warn('[Coupon Pilot] debug copy failed', error);
      logActivity('Could not copy debug report', 'error');
    }
  }
  function markPreview(element, kind, color) {
    if (!element) return;
    if (!previewOriginalStyles.has(element)) previewOriginalStyles.set(element, {
      outline: element.style.getPropertyValue('outline'),
      outlinePriority: element.style.getPropertyPriority('outline'),
      outlineOffset: element.style.getPropertyValue('outline-offset'),
      outlineOffsetPriority: element.style.getPropertyPriority('outline-offset')
    });
    element.setAttribute(PREVIEW_ATTR, kind);
    element.style.setProperty('outline', `2px solid ${color}`);
    element.style.setProperty('outline-offset', '2px');
  }
  function clearPreviewMarks() {
    document.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach(element => {
      const original = previewOriginalStyles.get(element);
      element.removeAttribute(PREVIEW_ATTR);
      if (original?.outline) element.style.setProperty('outline', original.outline, original.outlinePriority);
      else element.style.removeProperty('outline');
      if (original?.outlineOffset) element.style.setProperty('outline-offset', original.outlineOffset, original.outlineOffsetPriority);
      else element.style.removeProperty('outline-offset');
      previewOriginalStyles.delete(element);
    });
  }
  function refreshData() {
    const matching = getMatchingModules();
    syncPageObserver(Boolean(matching.length));
    activeModule = matching.length === 1 ? matching[0] : null;
    snapshot = [];
    if (matching.length > 1) health = { level: 'warning', message: `${matching.length} modules match this page; disable the extra module`, found: 0, available: 0, clipped: 0, ambiguous: 0 };
    else if (!activeModule) health = { level: 'warning', message: installedModuleRecords.length ? 'No enabled module matches this page' : 'Install a retailer module to get started', found: 0, available: 0, clipped: 0, ambiguous: 0 };
    else {
      try { const discovered = discoverModuleItems(activeModule); snapshot = classify(discovered, activeModule); health = activeModule.healthCheck(discovered); }
      catch (error) { health = { level: 'warning', message: 'Module inspection failed', found: 0, available: 0, clipped: 0, ambiguous: 0 }; console.warn('[Coupon Pilot] refresh failed', error); }
    }
    host.style.display = managerOpen || matching.length ? '' : 'none';
    render();
  }
  function scheduleRefresh(delay = 180) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshData, delay); }
  function syncPageObserver(shouldObserve) {
    if (shouldObserve && !pageObserver && document.body) {
      pageObserver = new MutationObserver(() => scheduleRefresh(220));
      pageObserver.observe(document.body, { childList: true, subtree: true });
    } else if (!shouldObserve && pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }
  }

  async function executeWithRetry(id, module, signal) {
    const attempts = Math.max(1, Number(state.automation.retryAttempts) || 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      try { await module.perform(id); if (await module.verify(id, { timeout: Number(state.automation.verifyTimeout) || 4500, signal })) return true; throw new Error('Clip action could not be verified'); }
      catch (error) { if (error?.name === 'AbortError' || attempt >= attempts) throw error; logActivity(`Retrying (${attempt}/${attempts})`, 'caution'); await sleep(700 * attempt, signal); }
    }
    return false;
  }

  async function revealMore(module, signal) {
    const beforeKnown = discoverModuleItems(module).length;
    const beforeHeight = document.documentElement.scrollHeight;
    const loadMore = module.findLoadMore?.();
    if (loadMore) {
      loadMore.scrollIntoView({ behavior: 'smooth', block: 'center' }); loadMore.click();
      const revealed = await waitFor(() => discoverModuleItems(module).length > beforeKnown || document.documentElement.scrollHeight > beforeHeight, { timeout: Number(state.automation.scrollDelay) + 1800, interval: 180, signal });
      return Boolean(revealed);
    }
    window.scrollBy({ top: Math.max(420, innerHeight * .82), behavior: 'smooth' });
    await sleep(Number(state.automation.scrollDelay) || 900, signal);
    return document.documentElement.scrollHeight !== beforeHeight || discoverModuleItems(module).length !== beforeKnown;
  }

  async function startRun() {
    if (running) return;
    const module = getActiveModule(); if (!module) return;
    const initialItems = discoverModuleItems(module); const initialHealth = module.healthCheck(initialItems);
    if (!initialItems.some(item => item.status === 'available')) return alert(initialHealth.message || 'No actionable coupons detected.');
    if (!classify(initialItems, module).some(item => item.status === 'available' && item.decision.eligible)) return alert('No eligible coupons match your current rules.');
    const dryRun = Boolean(state.automation.dryRun);
    const maxActions = Math.floor(clampNumber(state.automation.maxActions, DEFAULT_STATE.automation.maxActions, 1, 1000));
    const actionCount = () => runStats.acted + runStats.previewed + runStats.failed;
    clearPreviewMarks(); running = true; runStatus = dryRun ? 'preview' : 'running'; controller = new AbortController(); Object.assign(runStats, { acted: 0, blocked: 0, failed: 0, previewed: 0 });
    const processed = new Set(); let failures = 0, idleCycles = 0, previousHeight = -1, previousKnown = -1; render();
    try {
      while (!controller.signal.aborted && actionCount() < maxActions && idleCycles < 7) {
        let progress = false;
        for (const item of classify(discoverModuleItems(module), module)) {
          if (controller.signal.aborted) break;
          if (actionCount() >= maxActions) break;
          if (processed.has(item.id) || item.status !== 'available') continue;
          processed.add(item.id);
          if (!item.decision.eligible) { runStats.blocked++; if (dryRun) markPreview(item.element, 'blocked', '#f59e0b'); continue; }
          progress = true; item.element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(180, controller.signal);
          if (dryRun) { runStats.previewed++; markPreview(item.element, 'eligible', '#6366f1'); logActivity(`Would clip: ${item.title}`); }
          else { try { await executeWithRetry(item.id, module, controller.signal); runStats.acted++; failures = 0; logActivity(`Clipped: ${item.title}`, 'success'); } catch (error) { if (error?.name === 'AbortError') throw error; runStats.failed++; failures++; const reason = normalize(error?.message); logActivity(`Failed: ${item.title}${reason ? ` · ${reason}` : ''}`, 'error'); if (failures >= Number(state.automation.maxConsecutiveFailures)) throw new Error('Circuit breaker: repeated clip failures'); } }
          render(); await sleep(Number(state.automation.clickDelay) || 550, controller.signal);
        }
        const changed = await revealMore(module, controller.signal); const height = document.documentElement.scrollHeight; const known = discoverModuleItems(module).length;
        idleCycles = (progress || changed || height !== previousHeight || known !== previousKnown) ? 0 : idleCycles + 1; previousHeight = height; previousKnown = known;
      }
      runStatus = dryRun ? 'preview-complete' : 'complete';
    } catch (error) { runStatus = error?.name === 'AbortError' ? 'stopped' : 'error'; if (runStatus === 'error') logActivity(error.message || 'Run stopped after an error', 'error'); }
    finally { running = false; controller = null; getModuleState(module).lastRun = { at: new Date().toISOString(), dryRun, ...runStats, status: runStatus }; await persist(); refreshData(); }
  }

  function renderGroups() { const area = $('.chips'); area.innerHTML = ''; if (!activeModule) return; const rules = getSharedRules(); for (const name of Object.keys(DEFAULT_BLOCKED_GROUPS)) { const button = document.createElement('button'); button.className = `chip${rules.enabledGroups[name] ? ' on' : ''}`; button.textContent = name; button.onclick = async () => { rules.enabledGroups[name] = !rules.enabledGroups[name]; await persist(); refreshData(); }; area.append(button); } }
  function renderTerms() { const area = $('.terms'); area.innerHTML = ''; if (!activeModule) return; const rules = getSharedRules(); const key = activeRuleTab === 'always' ? 'alwaysTerms' : 'blockedTerms'; for (const term of rules[key]) { const tag = document.createElement('span'); tag.className = 'term'; tag.textContent = `${term} ×`; tag.onclick = async () => { rules[key] = rules[key].filter(value => value !== term); await persist(); refreshData(); }; area.append(tag); } }
  function appendTextRow(list, className, title, detail) {
    const row = document.createElement('div'); row.className = className;
    const titleElement = document.createElement('div'); titleElement.textContent = title;
    row.append(titleElement);
    if (detail) { const detailElement = document.createElement('div'); detailElement.className = 'meta'; detailElement.textContent = detail; row.append(detailElement); }
    list.append(row);
    return row;
  }
  function renderCoupons() { const query = normalize($('.search').value).toLowerCase(); const list = $('.couponList'); list.innerHTML = ''; for (const item of snapshot.filter(item => !query || itemSearchText(item).includes(query)).slice(0, 60)) { const detail = item.status === 'clipped' ? 'Clipped' : item.status === 'ambiguous' ? 'Needs review' : !item.decision.eligible ? `Blocked by “${item.decision.reason}”` : 'Eligible'; const row = appendTextRow(list, `coupon${!item.decision.eligible ? ' blocked' : item.status === 'clipped' ? ' clipped' : ''}`, item.title, detail); row.onclick = () => item.element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } if (!list.children.length) appendTextRow(list, 'empty', 'No matching loaded coupons.'); }
  function renderActivity() { const list = $('.activityList'); list.innerHTML = ''; if (!activity.length) { appendTextRow(list, 'empty', 'No run activity yet.'); return; } for (const entry of activity.slice(0, 14)) appendTextRow(list, `activity ${entry.level}`, `${entry.at.toLocaleTimeString()} · ${entry.message}`); }
  function renderModules() {
    $('.moduleManager').classList.toggle('hidden', !managerOpen);
    const list = $('.moduleList'); list.innerHTML = '';
    for (const record of installedModuleRecords) {
      let manifest = null, manifestError = null;
      try { manifest = parseModuleManifest(record.source); }
      catch (error) { manifestError = error?.message || String(error); }
      const id = manifest?.id || record.id || record.fileName;
      const loadError = moduleLoadErrors.find(error => error.id === id || error.id === record.fileName)?.message;
      const loaded = modules.find(module => module.id === id);
      const row = document.createElement('div'); row.className = 'moduleRow';
      const head = document.createElement('div'); head.className = 'moduleHead';
      const name = document.createElement('strong'); name.textContent = manifest ? `${manifest.name} v${manifest.version}` : id;
      const status = document.createElement('span'); status.className = 'moduleStatus'; status.textContent = record.enabled === false ? 'Disabled' : loaded?.matchPatterns.some(pattern => urlMatchesPattern(pattern)) ? 'Active here' : loadError || manifestError ? 'Error' : 'Enabled';
      head.append(name, status); row.append(head);
      const detail = document.createElement('div'); detail.className = 'meta'; detail.textContent = loadError || manifestError || manifest?.description || record.fileName; row.append(detail);
      if (manifest) { const matches = document.createElement('div'); matches.className = 'meta'; matches.textContent = manifest.matchPatterns.join(' · '); row.append(matches); }
      const actions = document.createElement('div'); actions.className = 'moduleActions';
      const toggle = document.createElement('button'); toggle.className = 'ghost'; toggle.textContent = record.enabled === false ? 'Enable' : 'Disable'; toggle.disabled = running; toggle.onclick = () => setModuleEnabled(id, record.enabled === false);
      const remove = document.createElement('button'); remove.className = 'ghost removeModule'; remove.textContent = 'Remove'; remove.disabled = running; remove.onclick = () => removeInstalledModule(id);
      actions.append(toggle, remove); row.append(actions); list.append(row);
    }
    if (!installedModuleRecords.length) appendTextRow(list, 'empty', 'No modules installed.');
    $('.moduleNotice').textContent = managerMessage || (moduleLoadErrors.length ? `${moduleLoadErrors.length} module(s) could not be loaded.` : '');
    $('.installModule').disabled = running;
  }
  function render() {
    $('.sub').textContent = activeModule ? `${activeModule.name} · ${activeModule.description || ''}` : 'Module manager';
    $('.healthDot').className = `healthDot ${health?.level || ''}`; $('.healthText').textContent = health?.message || 'Inspecting page';
    $('.found').textContent = snapshot.length; $('.eligible').textContent = snapshot.filter(item => item.status === 'available' && item.decision.eligible).length; $('.blockedCount').textContent = snapshot.filter(item => item.status === 'available' && !item.decision.eligible).length; $('.clippedCount').textContent = snapshot.filter(item => item.status === 'clipped').length;
    $('.dryRun').checked = Boolean(state.automation.dryRun); $('.dryRun').disabled = running; $('.delay').value = state.automation.clickDelay; $('.maxActions').value = state.automation.maxActions;
    const eligibleCount = snapshot.filter(item => item.status === 'available' && item.decision.eligible).length;
    $('.start').disabled = running || eligibleCount === 0; $('.stop').disabled = !running; $('.start').textContent = running ? 'Running…' : state.automation.dryRun ? 'Run dry preview' : 'Start clipping'; $('.runStatus').textContent = runStatus;
    $('.start').classList.toggle('hidden', !activeModule); $('.stop').classList.toggle('hidden', !activeModule); for (const section of $$('.activeOnly')) section.classList.toggle('hidden', !activeModule);
    app.classList.toggle('minimized', state.minimized); renderModules(); renderGroups(); renderTerms(); renderCoupons(); renderActivity();
  }

  $('.search').oninput = renderCoupons;
  $('.addTerm').onclick = async () => { if (!activeModule) return; const input = $('.termInput'); const term = normalize(input.value).toLowerCase(); if (!term) return; const rules = getSharedRules(); const key = activeRuleTab === 'always' ? 'alwaysTerms' : 'blockedTerms'; if (!rules[key].includes(term)) rules[key].push(term); input.value = ''; await persist(); refreshData(); };
  function selectRuleTab(event) { const selectedTab = event.currentTarget; activeRuleTab = selectedTab.dataset.tab; for (const candidate of $$('.tab')) candidate.classList.toggle('active', candidate === selectedTab); renderTerms(); }
  for (const tab of $$('.tab')) tab.onclick = selectRuleTab;
  $('.dryRun').onchange = async event => { if (running) return render(); state.automation.dryRun = event.target.checked; await persist(); if (!event.target.checked) clearPreviewMarks(); render(); };
  $('.delay').onchange = async event => { state.automation.clickDelay = clampNumber(event.target.value, DEFAULT_STATE.automation.clickDelay, 250, 5000); await persist(); render(); };
  $('.maxActions').onchange = async event => { state.automation.maxActions = Math.floor(clampNumber(event.target.value, DEFAULT_STATE.automation.maxActions, 1, 1000)); await persist(); render(); };
  $('.modulesToggle').onclick = () => { managerOpen = !managerOpen; if (!activeModule && !managerOpen) host.style.display = 'none'; else render(); };
  $('.installModule').onclick = () => $('.moduleFile').click();
  $('.moduleFile').onchange = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    managerMessage = `Checking ${file.name}…`; renderModules();
    try { if (await installModuleFile(file)) logActivity(`Installed module: ${file.name}`, 'success'); }
    catch (error) { managerMessage = error?.message || 'Module installation failed'; logActivity(managerMessage, 'error'); refreshData(); }
  };
  $('.debug').onclick = copyDebugReport; $('.start').onclick = startRun; $('.stop').onclick = () => controller?.abort(); $('.minimize').onclick = async () => { state.minimized = !state.minimized; await persist(); render(); };
  GM_registerMenuCommand('Coupon Pilot: Open panel', async () => { state.minimized = false; managerOpen = !getActiveModule(); await persist(); refreshData(); });
  GM_registerMenuCommand('Coupon Pilot: Manage modules', async () => { state.minimized = false; managerOpen = true; await persist(); refreshData(); });
  GM_registerMenuCommand('Coupon Pilot: Install local module…', () => $('.moduleFile').click());
  GM_registerMenuCommand('Coupon Pilot: Dry run', async () => { if (running) return; state.automation.dryRun = true; await persist(); startRun(); });
  GM_registerMenuCommand('Coupon Pilot: Start clipping', async () => { if (running) return; state.automation.dryRun = false; await persist(); clearPreviewMarks(); startRun(); });
  window.addEventListener('popstate', () => scheduleRefresh(250)); window.addEventListener('hashchange', () => scheduleRefresh(250));
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; scheduleRefresh(300); } }, 700);
  refreshData();
})();
