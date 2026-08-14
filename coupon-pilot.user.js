// ==UserScript==
// @name         Coupon Pilot
// @namespace    https://echomatter.local
// @version      0.3.1
// @description  Modular coupon-clipping assistant with rules, dry-run, verification, and retailer adapters.
// @match        https://www.harristeeter.com/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

// GENERATED FILE: edit src/coupon-pilot.shell.js or modules/*.js, then run node scripts/build.mjs.

(function registerHarrisTeeterModule(global) {
  'use strict';

  global.CouponPilotModuleFactories ??= [];
  global.CouponPilotModuleFactories.push(api => {
    const { normalize, textOf, visible, hash, waitFor, safeCouponIdentity } = api;
    return {
      apiVersion: 1,
      id: 'harris-teeter',
      name: 'Harris Teeter',
      description: 'Digital coupons',
      defaultBlockedGroups: {
        Baby: ['baby', 'diaper', 'diapers', 'formula', 'infant', 'toddler'],
        Pet: ['dog food', 'cat food', 'dog treat', 'cat treat', 'pet treat', 'litter'],
        Beauty: ['makeup', 'cosmetic', 'mascara', 'foundation', 'hair color'],
        Supplements: ['vitamin', 'supplement', 'probiotic'],
        Household: ['laundry', 'detergent', 'dishwasher', 'trash bag', 'air freshener']
      },
      matches() { return location.hostname === 'www.harristeeter.com' && /\/coupons(?:\/|$)/i.test(location.pathname); },
      isCouponControl(element) { if (!visible(element)) return false; const label = `${textOf(element)} ${normalize(element.getAttribute('aria-label'))}`; return /\bclip\b/i.test(label) || /\bclipped\b/i.test(label) || /\bunclip\b/i.test(label); },
      controlStatus(element) { if (!visible(element)) return 'ambiguous'; const visibleText = textOf(element); const label = `${visibleText} ${normalize(element.getAttribute('aria-label'))}`; if (/\bclipped\b|\bunclip\b|\bremove coupon\b/i.test(label)) return 'clipped'; const explicitClip = /^clip$/i.test(visibleText) || /\bclip coupon\b/i.test(label); return explicitClip && !element.disabled && element.getAttribute('aria-disabled') !== 'true' ? 'available' : 'ambiguous'; },
      couponControlsWithin(element) { return [...element.querySelectorAll('button, a, [role="button"]')].filter(control => this.isCouponControl(control)); },
      findCard(control) { for (const selector of ['[data-testid*="coupon" i]','[data-qa*="coupon" i]','[data-cy*="coupon" i]','[data-component*="coupon" i]']) { const candidate = control.closest(selector); if (!candidate) continue; const text = textOf(candidate); const controls = this.couponControlsWithin(candidate); if (text.length >= 20 && text.length <= 2500 && controls.length === 1) return candidate; } let node = control.parentElement; for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) { const text = textOf(node); if (text.length < 20 || text.length > 2200) continue; if (!/\bsave\b|\bexpires?\b|\bcoupon\b|\boff\b/i.test(text)) continue; const controls = this.couponControlsWithin(node); if (controls.length === 1 && controls[0] === control) return node; } return null; },
      itemId(card) { const direct = card?.getAttribute('data-coupon-id') || card?.getAttribute('data-offer-id'); if (direct) return `ht:${direct}`; const nested = card?.querySelector('[data-coupon-id], [data-offer-id]'); const nestedId = nested?.getAttribute('data-coupon-id') || nested?.getAttribute('data-offer-id'); return nestedId ? `ht:${nestedId}` : `ht:${hash(safeCouponIdentity(textOf(card)))}`; },
      discoverItems() { const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter(control => this.isCouponControl(control)); const byId = new Map(); for (const control of controls) { const card = this.findCard(control); if (!card) continue; const text = textOf(card); if (!text) continue; const id = this.itemId(card); const status = this.controlStatus(control); const title = normalize((card.innerText || card.textContent || text).split('\n').map(line => line.trim()).filter(Boolean).filter(line => !/^(clip|clipped|unclip)$/i.test(line)).slice(0,3).join(' · ')) || text.slice(0,140); const item = { id, text, title: title.slice(0,180), element: card, control, status }; const previous = byId.get(id); if (!previous || (previous.status === 'ambiguous' && status !== 'ambiguous')) byId.set(id,item); } return [...byId.values()]; },
      findLoadMore() { const couponControls = [...document.querySelectorAll('button, a, [role="button"]')].filter(control => this.isCouponControl(control)); const roots = [...new Set(couponControls.map(control => this.findCard(control)?.parentElement).filter(Boolean))]; for (const root of roots) { const candidate = [...root.querySelectorAll('button, a, [role="button"]')].find(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && /^(load more|show more|more coupons)$/i.test(textOf(element))); if (candidate) return candidate; } return null; },
      getItem(id) { return this.discoverItems().find(item => item.id === id) || null; },
      async perform(id) { const current = this.getItem(id); if (!current || current.status !== 'available' || !current.control?.isConnected) throw new Error('Coupon is no longer safely actionable'); current.control.scrollIntoView({ behavior: 'smooth', block: 'center' }); current.control.focus({ preventScroll: true }); current.control.click(); },
      async verify(id, { timeout, signal }) { return Boolean(await waitFor(() => this.getItem(id)?.status === 'clipped', { timeout, interval: 180, signal })); },
      healthCheck(items = this.discoverItems()) { const available = items.filter(item => item.status === 'available').length; const clipped = items.filter(item => item.status === 'clipped').length; const ambiguous = items.filter(item => item.status === 'ambiguous').length; if (!items.length) return { level: 'warning', message: 'No coupon cards detected yet', found: 0, available: 0, clipped: 0, ambiguous: 0 }; if (!available && clipped && !ambiguous) return { level: 'done', message: 'No unclipped coupons currently detected', found: items.length, available, clipped, ambiguous }; if (ambiguous) return { level: available ? 'caution' : 'warning', message: available ? `${available} ready · ${ambiguous} skipped as ambiguous` : `${ambiguous} ambiguous coupon controls detected`, found: items.length, available, clipped, ambiguous }; return { level: 'ready', message: `${available} ready to clip`, found: items.length, available, clipped, ambiguous }; }
    };
  });
})(globalThis);

(async function CouponPilot() {
  'use strict';

  const APP_VERSION = '0.3.1';
  const MODULE_API_VERSION = 1;
  const STORAGE_KEY = 'couponPilot:state';
  const PREVIEW_ATTR = 'data-coupon-pilot-preview';

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
  const textOf = element => normalize([element?.innerText, element?.textContent, element?.getAttribute?.('aria-label'), element?.getAttribute?.('title')].filter(Boolean).join(' '));
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
  function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }
  function migrateState(stored) {
    const storedAutomation = stored?.automation && typeof stored.automation === 'object' && !Array.isArray(stored.automation) ? stored.automation : {};
    const storedModules = stored?.modules && typeof stored.modules === 'object' && !Array.isArray(stored.modules) ? stored.modules : {};
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
      modules: storedModules
    };
  }

  let state = migrateState(await GM_getValue(STORAGE_KEY, DEFAULT_STATE));
  const persist = () => GM_setValue(STORAGE_KEY, state);
  const modules = [];
  const requiredFunctions = ['matches', 'discoverItems', 'perform', 'verify', 'healthCheck'];

  function registerModule(module) {
    if (!module || typeof module !== 'object') throw new Error('Invalid Coupon Pilot module');
    if (module.apiVersion !== MODULE_API_VERSION) throw new Error(`Unsupported Coupon Pilot module API: ${module.apiVersion ?? 'missing'}`);
    for (const key of ['id', 'name']) {
      if (typeof module[key] !== 'string' || !module[key].trim()) throw new Error(`Invalid Coupon Pilot module: ${key}`);
    }
    for (const key of requiredFunctions) {
      if (typeof module[key] !== 'function') throw new Error(`Invalid Coupon Pilot module: ${key} must be a function`);
    }
    if (modules.some(candidate => candidate.id === module.id)) throw new Error(`Duplicate Coupon Pilot module id: ${module.id}`);
    modules.push(module);
  }

  const moduleApi = Object.freeze({ apiVersion: MODULE_API_VERSION, normalize, textOf, visible, hash, waitFor, safeCouponIdentity });
  for (const factory of globalThis.CouponPilotModuleFactories || []) registerModule(factory(moduleApi));

  function getActiveModule() {
    return modules.find(module => {
      try { return module.matches(); }
      catch (error) { console.warn('[Coupon Pilot] module match failed', module.id, error); return false; }
    }) || null;
  }

  function getModuleState(module) {
    if (!state.modules[module.id] || typeof state.modules[module.id] !== 'object' || Array.isArray(state.modules[module.id])) {
      state.modules[module.id] = { blockedTerms: [], alwaysTerms: [], enabledGroups: {}, lastRun: null };
    }
    const moduleState = state.modules[module.id];
    if (!Array.isArray(moduleState.blockedTerms)) moduleState.blockedTerms = [];
    if (!Array.isArray(moduleState.alwaysTerms)) moduleState.alwaysTerms = [];
    if (!moduleState.enabledGroups || typeof moduleState.enabledGroups !== 'object' || Array.isArray(moduleState.enabledGroups)) moduleState.enabledGroups = {};
    for (const groupName of Object.keys(module.defaultBlockedGroups || {})) {
      if (!(groupName in moduleState.enabledGroups)) moduleState.enabledGroups[groupName] = false;
    }
    return moduleState;
  }

  const uniqueTerms = terms => [...new Set((Array.isArray(terms) ? terms : []).map(term => normalize(term).toLowerCase()).filter(Boolean))];
  function evaluateRules(item, module) {
    const haystack = item.text.toLowerCase();
    const moduleState = getModuleState(module);
    const always = uniqueTerms(moduleState.alwaysTerms).find(term => haystack.includes(term));
    if (always) return { eligible: true, reason: `always: ${always}` };
    const blocked = [...moduleState.blockedTerms];
    for (const [groupName, terms] of Object.entries(module.defaultBlockedGroups || {})) if (moduleState.enabledGroups[groupName]) blocked.push(...terms);
    const match = uniqueTerms(blocked).find(term => haystack.includes(term));
    return match ? { eligible: false, reason: match } : { eligible: true, reason: null };
  }
  const classify = (items, module) => items.map(item => ({ ...item, decision: evaluateRules(item, module) }));

  let activeModule = null, snapshot = [], health = null, controller = null, running = false, runStatus = 'idle', refreshTimer = null, lastUrl = location.href, activeRuleTab = 'block';
  const runStats = { acted: 0, blocked: 0, failed: 0, previewed: 0 };
  const activity = [];

  const host = document.createElement('div');
  host.id = 'coupon-pilot-host';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:none;max-width:calc(100vw - 24px)';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>*{box-sizing:border-box}button,input{font:inherit}.app{width:min(390px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;color:#eef2ff;background:#101522;border:1px solid #ffffff1c;border-radius:18px;box-shadow:0 24px 70px #0007;font:13px/1.35 system-ui,sans-serif}.app.minimized .body,.app.minimized .footer,.app.minimized .health{display:none}.header,.health,.section,.footer{padding:12px 14px}.header,.health,.footer{display:flex;align-items:center;gap:10px}.header,.health,.section{border-bottom:1px solid #ffffff12}.title{font-weight:800;flex:1}.sub,.health,.meta,.empty{color:#94a3b8;font-size:11px}.sectionTitle{font-size:10px;font-weight:800;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.stat{padding:8px;background:#ffffff09;border-radius:10px}.value{font-size:16px;font-weight:800}.chips,.terms{display:flex;flex-wrap:wrap;gap:6px}.chip,.tab,.ghost,.primary,.danger,.icon{border:0;border-radius:9px;cursor:pointer}.chip,.tab,.ghost,.icon{background:#ffffff10;color:#cbd5e1}.chip.on{background:#6d28d933;color:white}.chip{padding:6px 9px}.tabs{display:flex;gap:6px;margin-bottom:8px}.tab{padding:6px 9px}.tab.active{background:#4f46e555;color:white}.row{display:flex;gap:7px}.row input,.search{width:100%;padding:8px 10px;background:#ffffff0a;border:1px solid #ffffff18;border-radius:9px;color:white}.term{padding:5px 8px;border-radius:8px;background:#ffffff0a}.coupon,.activity{padding:7px 0;border-bottom:1px solid #ffffff0d}.blocked{color:#fca5a5}.clipped{color:#86efac}.footer{position:sticky;bottom:0;background:#101522}.primary,.danger{padding:10px 12px;color:white}.primary{background:#4f46e5;flex:1}.danger{background:#7f1d1d}.icon{padding:6px 9px}.healthDot{width:8px;height:8px;border-radius:50%;background:#64748b}.healthDot.ready{background:#34d399}.healthDot.caution{background:#fbbf24}.healthDot.warning{background:#f97316}.healthDot.done{background:#60a5fa}</style><div class="app"><div class="header"><strong class="title">Coupon Pilot</strong><span class="sub"></span><button class="icon minimize">−</button></div><div class="health"><span class="healthDot"></span><span class="healthText">Inspecting page</span><span class="sub">v${APP_VERSION}</span></div><div class="body"><div class="section"><input class="search" placeholder="Search loaded coupons…"></div><div class="section"><div class="stats"><div class="stat"><div class="value found">0</div><div class="meta">Found</div></div><div class="stat"><div class="value eligible">0</div><div class="meta">Eligible</div></div><div class="stat"><div class="value blockedCount">0</div><div class="meta">Blocked</div></div><div class="stat"><div class="value clippedCount">0</div><div class="meta">Clipped</div></div></div></div><div class="section"><div class="sectionTitle">Quick exclusions</div><div class="chips"></div></div><div class="section"><div class="sectionTitle">Keyword rules</div><div class="tabs"><button class="tab active" data-tab="block">Never clip</button><button class="tab" data-tab="always">Always clip</button></div><div class="row"><input class="termInput" placeholder="e.g. formula"><button class="ghost addTerm">Add</button></div><div class="terms"></div></div><div class="section"><label><input class="dryRun" type="checkbox"> Dry run</label> · <label>Delay <input class="delay" type="number" min="250" max="5000" style="width:72px"></label> · <label>Max <input class="maxActions" type="number" min="1" max="1000" style="width:72px"></label></div><div class="section"><div class="sectionTitle">Loaded coupons</div><div class="couponList"></div></div><div class="section"><div class="sectionTitle">Activity · <span class="runStatus">Idle</span></div><div class="activityList"></div></div></div><div class="footer"><button class="primary start">Run dry preview</button><button class="danger stop" disabled>Stop</button></div></div>`;

  const $ = selector => shadow.querySelector(selector);
  const $$ = selector => [...shadow.querySelectorAll(selector)];
  const app = $('.app');

  function logActivity(message, level = 'info') { activity.unshift({ message, level, at: new Date() }); activity.splice(20); renderActivity(); }
  function markPreview(element, kind, color) {
    element?.setAttribute(PREVIEW_ATTR, kind);
    element?.style.setProperty('outline', `2px solid ${color}`);
  }
  function clearPreviewMarks() { document.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach(element => { element.removeAttribute(PREVIEW_ATTR); element.style.removeProperty('outline'); element.style.removeProperty('outline-offset'); }); }
  function refreshData() {
    activeModule = getActiveModule();
    if (!activeModule) { snapshot = []; health = null; host.style.display = 'none'; return; }
    host.style.display = '';
    try { const discovered = activeModule.discoverItems(); snapshot = classify(discovered, activeModule); health = activeModule.healthCheck(discovered); }
    catch (error) { snapshot = []; health = { level: 'warning', message: 'Module inspection failed', found: 0, available: 0, clipped: 0, ambiguous: 0 }; console.warn('[Coupon Pilot] refresh failed', error); }
    render();
  }
  function scheduleRefresh(delay = 180) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshData, delay); }

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
    const beforeKnown = module.discoverItems().length;
    const beforeHeight = document.documentElement.scrollHeight;
    const loadMore = module.findLoadMore?.();
    if (loadMore) {
      loadMore.scrollIntoView({ behavior: 'smooth', block: 'center' }); loadMore.click();
      const revealed = await waitFor(() => module.discoverItems().length > beforeKnown || document.documentElement.scrollHeight > beforeHeight, { timeout: Number(state.automation.scrollDelay) + 1800, interval: 180, signal });
      return Boolean(revealed);
    }
    window.scrollBy({ top: Math.max(420, innerHeight * .82), behavior: 'smooth' });
    await sleep(Number(state.automation.scrollDelay) || 900, signal);
    return document.documentElement.scrollHeight !== beforeHeight || module.discoverItems().length !== beforeKnown;
  }

  async function startRun() {
    if (running) return;
    const module = getActiveModule(); if (!module) return;
    const initialItems = module.discoverItems(); const initialHealth = module.healthCheck(initialItems);
    if (!initialHealth.available) return alert(initialHealth.message || 'No actionable coupons detected.');
    const dryRun = Boolean(state.automation.dryRun);
    const maxActions = Math.floor(clampNumber(state.automation.maxActions, DEFAULT_STATE.automation.maxActions, 1, 1000));
    const actionCount = () => runStats.acted + runStats.previewed + runStats.failed;
    clearPreviewMarks(); running = true; runStatus = dryRun ? 'preview' : 'running'; controller = new AbortController(); Object.assign(runStats, { acted: 0, blocked: 0, failed: 0, previewed: 0 });
    const processed = new Set(); let failures = 0, idleCycles = 0, previousHeight = -1, previousKnown = -1; render();
    try {
      while (!controller.signal.aborted && actionCount() < maxActions && idleCycles < 7) {
        let progress = false;
        for (const item of classify(module.discoverItems(), module)) {
          if (controller.signal.aborted) break;
          if (actionCount() >= maxActions) break;
          if (processed.has(item.id) || item.status !== 'available') continue;
          processed.add(item.id);
          if (!item.decision.eligible) { runStats.blocked++; if (dryRun) markPreview(item.element, 'blocked', '#f59e0b'); continue; }
          progress = true; item.element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(180, controller.signal);
          if (dryRun) { runStats.previewed++; markPreview(item.element, 'eligible', '#6366f1'); logActivity(`Would clip: ${item.title}`); }
          else { try { await executeWithRetry(item.id, module, controller.signal); runStats.acted++; failures = 0; logActivity(`Clipped: ${item.title}`, 'success'); } catch (error) { if (error?.name === 'AbortError') throw error; runStats.failed++; failures++; logActivity(`Failed: ${item.title}`, 'error'); if (failures >= Number(state.automation.maxConsecutiveFailures)) throw new Error('Circuit breaker: repeated clip failures'); } }
          render(); await sleep(Number(state.automation.clickDelay) || 550, controller.signal);
        }
        const changed = await revealMore(module, controller.signal); const height = document.documentElement.scrollHeight; const known = module.discoverItems().length;
        idleCycles = (progress || changed || height !== previousHeight || known !== previousKnown) ? 0 : idleCycles + 1; previousHeight = height; previousKnown = known;
      }
      runStatus = dryRun ? 'preview-complete' : 'complete';
    } catch (error) { runStatus = error?.name === 'AbortError' ? 'stopped' : 'error'; if (runStatus === 'error') logActivity(error.message || 'Run stopped after an error', 'error'); }
    finally { running = false; controller = null; getModuleState(module).lastRun = { at: new Date().toISOString(), dryRun, ...runStats, status: runStatus }; await persist(); refreshData(); }
  }

  function renderGroups() { const area = $('.chips'); area.innerHTML = ''; if (!activeModule) return; const moduleState = getModuleState(activeModule); for (const name of Object.keys(activeModule.defaultBlockedGroups || {})) { const button = document.createElement('button'); button.className = `chip${moduleState.enabledGroups[name] ? ' on' : ''}`; button.textContent = name; button.onclick = async () => { moduleState.enabledGroups[name] = !moduleState.enabledGroups[name]; await persist(); refreshData(); }; area.append(button); } }
  function renderTerms() { const area = $('.terms'); area.innerHTML = ''; if (!activeModule) return; const moduleState = getModuleState(activeModule); const key = activeRuleTab === 'always' ? 'alwaysTerms' : 'blockedTerms'; for (const term of moduleState[key]) { const tag = document.createElement('span'); tag.className = 'term'; tag.textContent = `${term} ×`; tag.onclick = async () => { moduleState[key] = moduleState[key].filter(value => value !== term); await persist(); refreshData(); }; area.append(tag); } }
  function appendTextRow(list, className, title, detail) {
    const row = document.createElement('div'); row.className = className;
    const titleElement = document.createElement('div'); titleElement.textContent = title;
    row.append(titleElement);
    if (detail) { const detailElement = document.createElement('div'); detailElement.className = 'meta'; detailElement.textContent = detail; row.append(detailElement); }
    list.append(row);
    return row;
  }
  function renderCoupons() { const query = normalize($('.search').value).toLowerCase(); const list = $('.couponList'); list.innerHTML = ''; for (const item of snapshot.filter(item => !query || item.text.toLowerCase().includes(query)).slice(0, 60)) { const detail = item.status === 'clipped' ? 'Clipped' : item.status === 'ambiguous' ? 'Needs review' : !item.decision.eligible ? `Blocked by “${item.decision.reason}”` : 'Eligible'; const row = appendTextRow(list, `coupon${!item.decision.eligible ? ' blocked' : item.status === 'clipped' ? ' clipped' : ''}`, item.title, detail); row.onclick = () => item.element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } if (!list.children.length) appendTextRow(list, 'empty', 'No matching loaded coupons.'); }
  function renderActivity() { const list = $('.activityList'); list.innerHTML = ''; if (!activity.length) { appendTextRow(list, 'empty', 'No run activity yet.'); return; } for (const entry of activity.slice(0, 14)) appendTextRow(list, `activity ${entry.level}`, `${entry.at.toLocaleTimeString()} · ${entry.message}`); }
  function render() { $('.sub').textContent = activeModule ? `${activeModule.name} · ${activeModule.description || ''}` : ''; $('.healthDot').className = `healthDot ${health?.level || ''}`; $('.healthText').textContent = health?.message || 'Inspecting page'; $('.found').textContent = snapshot.length; $('.eligible').textContent = snapshot.filter(item => item.status === 'available' && item.decision.eligible).length; $('.blockedCount').textContent = snapshot.filter(item => item.status === 'available' && !item.decision.eligible).length; $('.clippedCount').textContent = snapshot.filter(item => item.status === 'clipped').length; $('.dryRun').checked = Boolean(state.automation.dryRun); $('.dryRun').disabled = running; $('.delay').value = state.automation.clickDelay; $('.maxActions').value = state.automation.maxActions; $('.start').disabled = running || !health?.available; $('.stop').disabled = !running; $('.start').textContent = running ? 'Running…' : state.automation.dryRun ? 'Run dry preview' : 'Start clipping'; $('.runStatus').textContent = runStatus; app.classList.toggle('minimized', state.minimized); renderGroups(); renderTerms(); renderCoupons(); renderActivity(); }

  $('.search').oninput = renderCoupons;
  $('.addTerm').onclick = async () => { if (!activeModule) return; const input = $('.termInput'); const term = normalize(input.value).toLowerCase(); if (!term) return; const moduleState = getModuleState(activeModule); const key = activeRuleTab === 'always' ? 'alwaysTerms' : 'blockedTerms'; if (!moduleState[key].includes(term)) moduleState[key].push(term); input.value = ''; await persist(); refreshData(); };
  for (const tab of $$('.tab')) tab.onclick = () => { activeRuleTab = tab.dataset.tab; for (const candidate of $$('.tab')) candidate.classList.toggle('active', candidate === tab); renderTerms(); };
  $('.dryRun').onchange = async event => { if (running) return render(); state.automation.dryRun = event.target.checked; await persist(); if (!event.target.checked) clearPreviewMarks(); render(); };
  $('.delay').onchange = async event => { state.automation.clickDelay = clampNumber(event.target.value, DEFAULT_STATE.automation.clickDelay, 250, 5000); await persist(); render(); };
  $('.maxActions').onchange = async event => { state.automation.maxActions = Math.floor(clampNumber(event.target.value, DEFAULT_STATE.automation.maxActions, 1, 1000)); await persist(); render(); };
  $('.start').onclick = startRun; $('.stop').onclick = () => controller?.abort(); $('.minimize').onclick = async () => { state.minimized = !state.minimized; await persist(); render(); };
  GM_registerMenuCommand('Coupon Pilot: Open panel', async () => { state.minimized = false; await persist(); refreshData(); });
  GM_registerMenuCommand('Coupon Pilot: Dry run', async () => { if (running) return; state.automation.dryRun = true; await persist(); startRun(); });
  GM_registerMenuCommand('Coupon Pilot: Start clipping', async () => { if (running) return; state.automation.dryRun = false; await persist(); clearPreviewMarks(); startRun(); });
  new MutationObserver(() => scheduleRefresh(220)).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => scheduleRefresh(250)); window.addEventListener('hashchange', () => scheduleRefresh(250));
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; scheduleRefresh(300); } }, 700);
  refreshData();
})();
