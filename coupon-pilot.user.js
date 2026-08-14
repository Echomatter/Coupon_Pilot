// ==UserScript==
// @name         Coupon Pilot
// @namespace    https://echomatter.local
// @version      0.1.0
// @description  Modular coupon-clipping automation with exclusions, dry-run, verification, and site adapters.
// @match        https://www.harristeeter.com/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async function CouponPilot() {
  'use strict';

  const APP_VERSION = '0.1.0';
  const STORAGE_KEY = 'couponPilot:state';
  const SCHEMA_VERSION = 1;

  const DEFAULT_STATE = {
    schemaVersion: SCHEMA_VERSION,
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
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(done, ms);

    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });

  const normalize = value => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  const textOf = element => normalize([
    element?.innerText,
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title')
  ].filter(Boolean).join(' '));

  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden';
  };

  const hash = input => {
    let value = 2166136261;
    const text = String(input);
    for (let i = 0; i < text.length; i++) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(36);
  };

  async function waitFor(predicate, {
    timeout = 4000,
    interval = 150,
    signal
  } = {}) {
    const started = performance.now();

    while (performance.now() - started < timeout) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const result = await predicate();
      if (result) return result;
      await sleep(interval, signal);
    }

    return false;
  }

  function mergeState(stored) {
    const next = structuredClone(DEFAULT_STATE);
    if (!stored || typeof stored !== 'object') return next;

    next.minimized = Boolean(stored.minimized);
    next.automation = {
      ...next.automation,
      ...(stored.automation || {})
    };
    next.modules = stored.modules && typeof stored.modules === 'object'
      ? stored.modules
      : {};
    next.schemaVersion = SCHEMA_VERSION;
    return next;
  }

  let state = mergeState(await GM_getValue(STORAGE_KEY, DEFAULT_STATE));

  async function persist() {
    await GM_setValue(STORAGE_KEY, state);
  }

  const modules = [];

  function registerModule(module) {
    modules.push(module);
  }

  function getActiveModule() {
    return modules.find(module => {
      try {
        return module.matches();
      } catch (error) {
        console.warn('[Coupon Pilot] module match failed', module.id, error);
        return false;
      }
    }) || null;
  }

  function getModuleState(module) {
    if (!state.modules[module.id]) {
      state.modules[module.id] = {
        blockedTerms: [],
        alwaysTerms: [],
        enabledGroups: {},
        lastRun: null
      };
    }

    const moduleState = state.modules[module.id];

    for (const groupName of Object.keys(module.defaultBlockedGroups || {})) {
      if (!(groupName in moduleState.enabledGroups)) {
        moduleState.enabledGroups[groupName] = false;
      }
    }

    moduleState.blockedTerms ||= [];
    moduleState.alwaysTerms ||= [];
    return moduleState;
  }

  function getEnabledBlockedTerms(module) {
    const moduleState = getModuleState(module);
    const terms = [...moduleState.blockedTerms];

    for (const [groupName, groupTerms] of Object.entries(module.defaultBlockedGroups || {})) {
      if (moduleState.enabledGroups[groupName]) {
        terms.push(...groupTerms);
      }
    }

    return [...new Set(terms
      .map(term => normalize(term).toLowerCase())
      .filter(Boolean))];
  }

  function evaluateRules(item, module) {
    const haystack = item.text.toLowerCase();
    const moduleState = getModuleState(module);

    const always = moduleState.alwaysTerms
      .map(term => normalize(term).toLowerCase())
      .filter(Boolean)
      .find(term => haystack.includes(term));

    if (always) {
      return { eligible: true, reason: `always: ${always}` };
    }

    const blocked = getEnabledBlockedTerms(module)
      .find(term => haystack.includes(term));

    if (blocked) {
      return { eligible: false, reason: blocked };
    }

    return { eligible: true, reason: null };
  }

  function classify(items, module) {
    return items.map(item => ({
      ...item,
      decision: evaluateRules(item, module)
    }));
  }

  function safeCouponIdentity(text) {
    return normalize(text)
      .toLowerCase()
      .replace(/\bclipped\b/g, '')
      .replace(/\bunclip\b/g, '')
      .replace(/\bremove coupon\b/g, '')
      .replace(/\bclip coupon\b/g, '')
      .replace(/\bclip\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  registerModule({
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

    matches() {
      return location.hostname === 'www.harristeeter.com' &&
        /\/coupons(?:\/|$)/i.test(location.pathname);
    },

    isCouponControl(element) {
      if (!visible(element)) return false;
      const text = textOf(element);
      const aria = normalize(element.getAttribute('aria-label'));
      return /\bclip(?:ped)?\b/i.test(text) || /\bclip(?:ped)?\b/i.test(aria);
    },

    controlStatus(element) {
      const value = `${textOf(element)} ${normalize(element.getAttribute('aria-label'))}`;
      if (/clipped|unclip|remove coupon/i.test(value) || element.disabled) return 'clipped';
      if (/^clip$/i.test(textOf(element)) || /\bclip coupon\b/i.test(value)) return 'available';
      return 'ambiguous';
    },

    findCard(control) {
      const explicit = control.closest([
        '[data-testid*="coupon" i]',
        '[data-qa*="coupon" i]',
        '[data-cy*="coupon" i]'
      ].join(','));

      if (explicit && textOf(explicit).length <= 2500) return explicit;

      let node = control;
      for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
        const text = textOf(node);
        if (text.length < 20 || text.length > 2200) continue;

        const couponish = /\bsave\b|\bexpires?\b|\bcoupon\b|\boff\b/i.test(text);
        if (!couponish) continue;

        const clipControls = [...node.querySelectorAll('button, a, [role="button"]')]
          .filter(candidate => this.isCouponControl(candidate));

        if (clipControls.length === 1) return node;
      }

      return control.parentElement;
    },

    itemId(card) {
      const explicitId = card?.getAttribute('data-coupon-id') ||
        card?.getAttribute('data-offer-id') ||
        card?.getAttribute('data-id');

      if (explicitId) return `ht:${explicitId}`;
      return `ht:${hash(safeCouponIdentity(textOf(card)))}`;
    },

    discoverItems() {
      const controls = [...document.querySelectorAll('button, a, [role="button"]')]
        .filter(element => this.isCouponControl(element));

      const byId = new Map();

      for (const control of controls) {
        const card = this.findCard(control);
        if (!card) continue;

        const text = textOf(card);
        if (!text) continue;

        const id = this.itemId(card);
        const status = this.controlStatus(control);
        const title = normalize((card.innerText || card.textContent || text)
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .filter(line => !/^(clip|clipped)$/i.test(line))
          .slice(0, 3)
          .join(' · ')) || text.slice(0, 120);

        const existing = byId.get(id);
        if (!existing || existing.status === 'ambiguous') {
          byId.set(id, {
            id,
            text,
            title: title.slice(0, 180),
            element: card,
            control,
            status
          });
        }
      }

      return [...byId.values()];
    },

    findLoadMore() {
      return [...document.querySelectorAll('button, a, [role="button"]')]
        .find(element => {
          if (!visible(element) || element.disabled) return false;
          return /^(load more|show more|more coupons)$/i.test(textOf(element));
        }) || null;
    },

    getItem(id) {
      return this.discoverItems().find(item => item.id === id) || null;
    },

    async perform(id) {
      const current = this.getItem(id);
      if (!current || current.status !== 'available' || !current.control) {
        throw new Error('Coupon is no longer actionable');
      }
      current.control.scrollIntoView({ behavior: 'smooth', block: 'center' });
      current.control.click();
    },

    async verify(id, { timeout, signal }) {
      const result = await waitFor(() => {
        const current = this.getItem(id);
        if (!current) return 'missing';
        if (current.status === 'clipped') return 'clipped';
        return false;
      }, {
        timeout,
        interval: 180,
        signal
      });

      return Boolean(result);
    },

    healthCheck() {
      const items = this.discoverItems();
      const available = items.filter(item => item.status === 'available').length;
      const clipped = items.filter(item => item.status === 'clipped').length;
      const ambiguous = items.filter(item => item.status === 'ambiguous').length;

      let level = 'ready';
      let message = `${available} ready to clip`;

      if (items.length === 0) {
        level = 'warning';
        message = 'No coupon cards detected yet';
      } else if (available === 0 && clipped > 0 && ambiguous === 0) {
        level = 'done';
        message = 'No unclipped coupons currently detected';
      } else if (ambiguous > 0) {
        level = 'warning';
        message = `${ambiguous} ambiguous coupon control${ambiguous === 1 ? '' : 's'} detected`;
      }

      return {
        level,
        message,
        found: items.length,
        available,
        clipped,
        ambiguous
      };
    }
  });

  let activeModule = null;
  let snapshot = [];
  let health = null;
  let controller = null;
  let running = false;
  let runStatus = 'idle';
  let activity = [];
  let refreshTimer = null;

  const runStats = {
    acted: 0,
    blocked: 0,
    failed: 0,
    previewed: 0
  };

  function logActivity(message, level = 'info') {
    activity.unshift({
      at: new Date(),
      message,
      level
    });
    activity = activity.slice(0, 30);
    renderActivity();
  }

  function refreshData() {
    activeModule = getActiveModule();

    if (!activeModule) {
      snapshot = [];
      health = null;
      host.style.display = 'none';
      return;
    }

    host.style.display = '';

    try {
      snapshot = classify(activeModule.discoverItems(), activeModule);
      health = activeModule.healthCheck();
    } catch (error) {
      snapshot = [];
      health = {
        level: 'warning',
        message: 'Module inspection failed',
        found: 0,
        available: 0,
        clipped: 0,
        ambiguous: 0
      };
      console.warn('[Coupon Pilot] refresh failed', error);
    }

    render();
  }

  function scheduleRefresh(delay = 180) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshData, delay);
  }

  async function executeWithRetry(id, module, signal) {
    const attempts = Math.max(1, Number(state.automation.retryAttempts) || 1);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      try {
        await module.perform(id);
        const verified = await module.verify(id, {
          timeout: Number(state.automation.verifyTimeout) || 4500,
          signal
        });

        if (verified) return true;
        throw new Error('Clip action could not be verified');
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (attempt >= attempts) throw error;
        await sleep(700 * attempt, signal);
      }
    }

    return false;
  }

  async function startRun() {
    if (running) return;

    const module = getActiveModule();
    if (!module) {
      toast('No supported coupon module is active on this page.');
      return;
    }

    const initialHealth = module.healthCheck();
    if (initialHealth.level === 'warning' && initialHealth.found === 0) {
      toast('No coupon cards are detected yet. Let the page finish loading and try again.');
      return;
    }

    running = true;
    runStatus = state.automation.dryRun ? 'preview' : 'running';
    controller = new AbortController();

    Object.assign(runStats, { acted: 0, blocked: 0, failed: 0, previewed: 0 });

    const processed = new Set();
    let consecutiveFailures = 0;
    let idleCycles = 0;
    let previousHeight = -1;
    let previousKnown = -1;

    logActivity(state.automation.dryRun ? 'Dry run started' : 'Clip run started');
    render();

    try {
      while (!controller.signal.aborted &&
        runStats.acted + runStats.previewed < Number(state.automation.maxActions) &&
        idleCycles < 7) {

        const items = classify(module.discoverItems(), module);
        let progress = false;

        for (const item of items) {
          if (controller.signal.aborted) break;
          if (processed.has(item.id)) continue;
          if (item.status !== 'available') continue;

          processed.add(item.id);

          if (!item.decision.eligible) {
            runStats.blocked++;
            if (state.automation.dryRun) {
              item.element?.setAttribute('data-coupon-pilot-preview', 'blocked');
              item.element?.style.setProperty('outline', '2px solid rgba(245,158,11,.85)');
              item.element?.style.setProperty('outline-offset', '2px');
            }
            continue;
          }

          progress = true;
          item.element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(180, controller.signal);

          if (state.automation.dryRun) {
            runStats.previewed++;
            item.element?.setAttribute('data-coupon-pilot-preview', 'eligible');
            item.element?.style.setProperty('outline', '2px solid rgba(99,102,241,.85)');
            item.element?.style.setProperty('outline-offset', '2px');
            logActivity(`Would clip: ${item.title}`);
          } else {
            try {
              await executeWithRetry(item.id, module, controller.signal);
              runStats.acted++;
              consecutiveFailures = 0;
              logActivity(`Clipped: ${item.title}`);
            } catch (error) {
              if (error?.name === 'AbortError') throw error;
              runStats.failed++;
              consecutiveFailures++;
              logActivity(`Failed: ${item.title}`, 'error');

              if (consecutiveFailures >= Number(state.automation.maxConsecutiveFailures)) {
                throw new Error('Circuit breaker: repeated clip failures');
              }
            }
          }

          render();
          await sleep(Number(state.automation.clickDelay) || 550, controller.signal);

          if (runStats.acted + runStats.previewed >= Number(state.automation.maxActions)) break;
        }

        const beforeKnown = module.discoverItems().length;
        const beforeHeight = document.documentElement.scrollHeight;
        const loadMore = module.findLoadMore?.();

        if (loadMore && !controller.signal.aborted) {
          loadMore.scrollIntoView({ behavior: 'smooth', block: 'center' });
          loadMore.click();
          progress = true;

          await waitFor(() => {
            const nowKnown = module.discoverItems().length;
            return nowKnown > beforeKnown || document.documentElement.scrollHeight > beforeHeight;
          }, {
            timeout: Number(state.automation.scrollDelay) + 1800,
            interval: 180,
            signal: controller.signal
          });
        }

        window.scrollBy({
          top: Math.max(420, window.innerHeight * 0.82),
          behavior: 'smooth'
        });

        await sleep(Number(state.automation.scrollDelay) || 900, controller.signal);

        const height = document.documentElement.scrollHeight;
        const known = module.discoverItems().length;

        if (progress || height !== previousHeight || known !== previousKnown) {
          idleCycles = 0;
        } else {
          idleCycles++;
        }

        previousHeight = height;
        previousKnown = known;
        scheduleRefresh();
      }

      runStatus = state.automation.dryRun ? 'preview-complete' : 'complete';
      logActivity(state.automation.dryRun
        ? `Dry run complete: ${runStats.previewed} eligible coupon${runStats.previewed === 1 ? '' : 's'}`
        : `Run complete: ${runStats.acted} clipped, ${runStats.failed} failed`);
    } catch (error) {
      if (error?.name === 'AbortError') {
        runStatus = 'stopped';
        logActivity('Run stopped');
      } else {
        runStatus = 'error';
        logActivity(error?.message || 'Run stopped after an error', 'error');
        toast('Coupon Pilot stopped because repeated actions could not be verified.');
      }
    } finally {
      running = false;
      controller = null;

      const moduleState = getModuleState(module);
      moduleState.lastRun = {
        at: new Date().toISOString(),
        dryRun: state.automation.dryRun,
        acted: runStats.acted,
        previewed: runStats.previewed,
        blocked: runStats.blocked,
        failed: runStats.failed,
        status: runStatus
      };
      await persist();
      refreshData();
    }
  }

  function stopRun() {
    controller?.abort();
  }

  const host = document.createElement('div');
  host.id = 'coupon-pilot-host';
  host.style.cssText = [
    'position:fixed',
    'right:22px',
    'bottom:22px',
    'z-index:2147483647',
    'display:none'
  ].join(';');
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      :host { color-scheme: dark; }

      .app {
        width: 390px;
        max-height: min(760px, calc(100vh - 44px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #eef2ff;
        background:
          radial-gradient(circle at 20% -10%, rgba(99,102,241,.25), transparent 34%),
          linear-gradient(160deg, rgba(18,22,32,.985), rgba(8,11,18,.985));
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 22px;
        box-shadow: 0 28px 90px rgba(0,0,0,.42), inset 0 1px rgba(255,255,255,.04);
        backdrop-filter: blur(22px);
        font: 13px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .app.minimized {
        width: auto;
        min-width: 178px;
      }

      .app.minimized .body,
      .app.minimized .footer,
      .app.minimized .healthRow { display: none; }

      .header {
        min-height: 62px;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid rgba(255,255,255,.07);
      }

      .mark {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border-radius: 11px;
        color: white;
        background: linear-gradient(135deg, #8b5cf6, #4f46e5);
        box-shadow: 0 8px 28px rgba(79,70,229,.35);
        font-size: 12px;
        font-weight: 850;
        letter-spacing: -.03em;
      }

      .heading { min-width: 0; flex: 1; }
      .title { font-size: 14px; font-weight: 780; letter-spacing: -.015em; }
      .subtitle {
        margin-top: 2px;
        overflow: hidden;
        color: #8f9bb3;
        font-size: 11px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .iconButton, .ghostButton, .chip, .tab, .primaryButton, .dangerButton {
        appearance: none;
        border: 0;
        font: inherit;
        cursor: pointer;
      }

      .iconButton {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        color: #aeb8cb;
        background: rgba(255,255,255,.055);
        border: 1px solid rgba(255,255,255,.055);
        border-radius: 10px;
      }
      .iconButton:hover { background: rgba(255,255,255,.10); color: #fff; }

      .healthRow {
        padding: 9px 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #9aa6ba;
        background: rgba(255,255,255,.025);
        border-bottom: 1px solid rgba(255,255,255,.06);
        font-size: 11px;
      }
      .healthDot { width: 7px; height: 7px; border-radius: 999px; background: #64748b; }
      .healthDot.ready { background: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,.09); }
      .healthDot.done { background: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,.09); }
      .healthDot.warning { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.09); }
      .healthText { flex: 1; }
      .version { color: #596579; }

      .body { overflow: auto; }
      .section { padding: 14px; border-bottom: 1px solid rgba(255,255,255,.065); }
      .section:last-child { border-bottom: 0; }

      .searchWrap { position: relative; }
      .searchIcon {
        position: absolute;
        top: 10px;
        left: 12px;
        color: #69758a;
        pointer-events: none;
      }
      input[type="text"], input[type="number"] {
        height: 40px;
        color: #f8fafc;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        outline: none;
      }
      input[type="text"]:focus, input[type="number"]:focus {
        border-color: rgba(129,140,248,.75);
        box-shadow: 0 0 0 3px rgba(99,102,241,.13);
      }
      .search { width: 100%; padding: 0 12px 0 36px; }
      .keywordInput { flex: 1; min-width: 0; padding: 0 11px; }
      .numberInput { width: 74px; padding: 0 8px; }

      .stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 7px;
      }
      .stat {
        min-width: 0;
        padding: 10px 9px;
        background: rgba(255,255,255,.032);
        border: 1px solid rgba(255,255,255,.065);
        border-radius: 12px;
      }
      .statValue { color: #f8fafc; font-size: 17px; font-weight: 800; letter-spacing: -.025em; }
      .statLabel {
        margin-top: 2px;
        color: #677389;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .sectionTitle {
        margin-bottom: 9px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #8e9aaf;
        font-size: 10px;
        font-weight: 760;
        letter-spacing: .09em;
        text-transform: uppercase;
      }

      .chips, .terms { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        height: 30px;
        padding: 0 11px;
        color: #aeb8ca;
        background: rgba(255,255,255,.035);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 999px;
        font-size: 11px;
      }
      .chip:hover { color: #fff; background: rgba(255,255,255,.07); }
      .chip.on {
        color: #ddd6fe;
        background: rgba(124,58,237,.17);
        border-color: rgba(139,92,246,.48);
      }

      .tabs {
        margin-bottom: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 3px;
        background: rgba(255,255,255,.035);
        border-radius: 11px;
      }
      .tab {
        height: 30px;
        color: #8490a4;
        background: transparent;
        border-radius: 8px;
        font-size: 11px;
      }
      .tab.active { color: #f4f4ff; background: rgba(255,255,255,.075); box-shadow: 0 1px 5px rgba(0,0,0,.18); }

      .keywordRow { display: flex; gap: 7px; }
      .ghostButton {
        height: 40px;
        padding: 0 13px;
        color: #d2d8e4;
        background: rgba(255,255,255,.07);
        border-radius: 11px;
      }
      .ghostButton:hover { background: rgba(255,255,255,.11); }

      .terms { margin-top: 9px; }
      .term {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 5px 8px;
        border-radius: 8px;
        font-size: 11px;
      }
      .term.block { color: #fecaca; background: rgba(239,68,68,.10); }
      .term.always { color: #bbf7d0; background: rgba(34,197,94,.10); }
      .term span { overflow: hidden; text-overflow: ellipsis; }
      .term button { padding: 0; color: currentColor; background: transparent; border: 0; cursor: pointer; opacity: .65; }
      .term button:hover { opacity: 1; }

      .settingsGrid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px 12px;
        align-items: center;
      }
      .setting { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #aab4c6; font-size: 11px; }
      .switchLabel { display: inline-flex; align-items: center; gap: 7px; }
      input[type="checkbox"] { accent-color: #6366f1; }

      .couponList, .activityList { max-height: 190px; overflow: auto; }
      .couponRow, .activityRow {
        padding: 9px 0;
        border-bottom: 1px solid rgba(255,255,255,.05);
      }
      .couponRow:last-child, .activityRow:last-child { border-bottom: 0; }
      .couponRow { cursor: pointer; }
      .couponTitle { color: #cbd5e1; font-size: 11px; line-height: 1.4; }
      .couponMeta { margin-top: 3px; color: #64748b; font-size: 10px; }
      .couponRow.blocked .couponTitle { color: #fca5a5; }
      .couponRow.clipped .couponTitle { color: #86efac; }
      .activityRow { color: #9aa6ba; font-size: 10px; line-height: 1.4; }
      .activityRow.error { color: #fca5a5; }
      .empty { padding: 8px 0; color: #667287; font-size: 11px; }

      .footer {
        padding: 12px 14px 14px;
        display: grid;
        grid-template-columns: 1fr 92px;
        gap: 8px;
        background: rgba(8,11,18,.94);
        border-top: 1px solid rgba(255,255,255,.07);
      }
      .primaryButton, .dangerButton {
        height: 42px;
        border-radius: 12px;
        font-weight: 760;
      }
      .primaryButton {
        color: white;
        background: linear-gradient(135deg, #7c3aed, #4f46e5);
        box-shadow: 0 9px 24px rgba(79,70,229,.23);
      }
      .primaryButton:hover { filter: brightness(1.08); }
      .primaryButton:disabled { opacity: .46; cursor: default; filter: none; }
      .dangerButton {
        color: #fecaca;
        background: rgba(239,68,68,.09);
        border: 1px solid rgba(239,68,68,.13);
      }
      .dangerButton:disabled { opacity: .3; cursor: default; }

      .toast {
        position: absolute;
        right: 0;
        bottom: calc(100% + 10px);
        width: min(360px, calc(100vw - 44px));
        padding: 10px 12px;
        color: #f8fafc;
        background: #111827;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 11px;
        box-shadow: 0 14px 36px rgba(0,0,0,.35);
        opacity: 0;
        transform: translateY(5px);
        pointer-events: none;
        transition: opacity .16s ease, transform .16s ease;
        font-size: 11px;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
    </style>

    <div class="toast"></div>

    <div class="app">
      <div class="header">
        <div class="mark">CP</div>
        <div class="heading">
          <div class="title">Coupon Pilot</div>
          <div class="subtitle">Waiting for a supported coupon page</div>
        </div>
        <button class="iconButton minimize" title="Minimize">−</button>
      </div>

      <div class="healthRow">
        <span class="healthDot"></span>
        <span class="healthText">Inspecting page</span>
        <span class="version">v${APP_VERSION}</span>
      </div>

      <div class="body">
        <div class="section">
          <div class="searchWrap">
            <span class="searchIcon">⌕</span>
            <input class="search" type="text" placeholder="Search loaded coupons…" />
          </div>
        </div>

        <div class="section">
          <div class="stats">
            <div class="stat"><div class="statValue found">0</div><div class="statLabel">Found</div></div>
            <div class="stat"><div class="statValue eligible">0</div><div class="statLabel">Eligible</div></div>
            <div class="stat"><div class="statValue blocked">0</div><div class="statLabel">Blocked</div></div>
            <div class="stat"><div class="statValue clipped">0</div><div class="statLabel">Clipped</div></div>
          </div>
        </div>

        <div class="section groupsSection">
          <div class="sectionTitle"><span>Quick exclusions</span><span>site-specific</span></div>
          <div class="chips"></div>
        </div>

        <div class="section">
          <div class="sectionTitle"><span>Keyword rules</span><span class="ruleHint">Never clip</span></div>
          <div class="tabs">
            <button class="tab active" data-rule-tab="block">Never clip</button>
            <button class="tab" data-rule-tab="always">Always clip</button>
          </div>
          <div class="keywordRow">
            <input class="keywordInput" type="text" placeholder="e.g. formula" />
            <button class="ghostButton addTerm">Add</button>
          </div>
          <div class="terms"></div>
        </div>

        <div class="section">
          <div class="sectionTitle"><span>Run settings</span><span>saved locally</span></div>
          <div class="settingsGrid">
            <label class="setting switchLabel"><span>Dry run</span><input class="dryRun" type="checkbox" /></label>
            <label class="setting"><span>Delay ms</span><input class="numberInput delay" type="number" min="250" step="50" /></label>
            <label class="setting"><span>Max actions</span><input class="numberInput maxActions" type="number" min="1" max="1000" /></label>
            <label class="setting"><span>Retries</span><input class="numberInput retries" type="number" min="1" max="4" /></label>
          </div>
        </div>

        <div class="section">
          <div class="sectionTitle"><span>Loaded coupons</span><span class="resultCount">0</span></div>
          <div class="couponList"></div>
        </div>

        <div class="section">
          <div class="sectionTitle"><span>Activity</span><span class="runStatus">Idle</span></div>
          <div class="activityList"></div>
        </div>
      </div>

      <div class="footer">
        <button class="primaryButton start">Run dry preview</button>
        <button class="dangerButton stop" disabled>Stop</button>
      </div>
    </div>
  `;

  const $ = selector => shadow.querySelector(selector);
  const $$ = selector => [...shadow.querySelectorAll(selector)];
  const app = $('.app');

  let activeRuleTab = 'block';
  let toastTimer = null;

  function toast(message) {
    const element = $('.toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2400);
  }

  function renderGroups() {
    const area = $('.chips');
    area.innerHTML = '';
    if (!activeModule) return;

    const moduleState = getModuleState(activeModule);

    for (const groupName of Object.keys(activeModule.defaultBlockedGroups || {})) {
      const button = document.createElement('button');
      button.className = `chip${moduleState.enabledGroups[groupName] ? ' on' : ''}`;
      button.textContent = groupName;
      button.addEventListener('click', async () => {
        moduleState.enabledGroups[groupName] = !moduleState.enabledGroups[groupName];
        await persist();
        refreshData();
      });
      area.appendChild(button);
    }
  }

  function renderTerms() {
    const area = $('.terms');
    area.innerHTML = '';
    if (!activeModule) return;

    const moduleState = getModuleState(activeModule);
    const list = activeRuleTab === 'always'
      ? moduleState.alwaysTerms
      : moduleState.blockedTerms;

    for (const termText of list) {
      const tag = document.createElement('div');
      tag.className = `term ${activeRuleTab === 'always' ? 'always' : 'block'}`;

      const label = document.createElement('span');
      label.textContent = termText;

      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = `Remove ${termText}`;
      remove.addEventListener('click', async () => {
        const key = activeRuleTab === 'always' ? 'alwaysTerms' : 'blockedTerms';
        moduleState[key] = moduleState[key].filter(value => value !== termText);
        await persist();
        refreshData();
      });

      tag.append(label, remove);
      area.appendChild(tag);
    }
  }

  function renderCoupons() {
    const list = $('.couponList');
    list.innerHTML = '';

    const query = normalize($('.search').value).toLowerCase();
    const filtered = snapshot.filter(item => !query || item.text.toLowerCase().includes(query));
    $('.resultCount').textContent = String(filtered.length);

    if (!filtered.length) {
      list.innerHTML = '<div class="empty">No matching loaded coupons.</div>';
      return;
    }

    for (const item of filtered.slice(0, 60)) {
      const row = document.createElement('div');
      row.className = 'couponRow';
      if (!item.decision.eligible) row.classList.add('blocked');
      if (item.status === 'clipped') row.classList.add('clipped');

      const title = document.createElement('div');
      title.className = 'couponTitle';
      title.textContent = item.title;

      const meta = document.createElement('div');
      meta.className = 'couponMeta';
      if (item.status === 'clipped') {
        meta.textContent = 'Clipped';
      } else if (!item.decision.eligible) {
        meta.textContent = `Blocked by “${item.decision.reason}”`;
      } else if (item.decision.reason?.startsWith('always:')) {
        meta.textContent = `Always clip · ${item.decision.reason.replace('always: ', '')}`;
      } else {
        meta.textContent = item.status === 'ambiguous' ? 'Needs review' : 'Eligible';
      }

      row.append(title, meta);
      row.addEventListener('click', () => {
        item.element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      list.appendChild(row);
    }
  }

  function renderActivity() {
    const list = $('.activityList');
    if (!list) return;
    list.innerHTML = '';

    if (!activity.length) {
      list.innerHTML = '<div class="empty">No run activity yet.</div>';
      return;
    }

    for (const entry of activity.slice(0, 12)) {
      const row = document.createElement('div');
      row.className = `activityRow${entry.level === 'error' ? ' error' : ''}`;
      const time = entry.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      row.textContent = `${time} · ${entry.message}`;
      list.appendChild(row);
    }
  }

  function renderHeader() {
    $('.subtitle').textContent = activeModule
      ? `${activeModule.name} · ${activeModule.description}`
      : 'Waiting for a supported coupon page';

    const dot = $('.healthDot');
    dot.className = `healthDot ${health?.level || ''}`;
    $('.healthText').textContent = health?.message || 'Inspecting page';
  }

  function renderStats() {
    const found = snapshot.length;
    const eligible = snapshot.filter(item => item.status === 'available' && item.decision.eligible).length;
    const blocked = snapshot.filter(item => item.status === 'available' && !item.decision.eligible).length;
    const clipped = snapshot.filter(item => item.status === 'clipped').length;

    $('.found').textContent = String(found);
    $('.eligible').textContent = String(eligible);
    $('.blocked').textContent = String(blocked);
    $('.clipped').textContent = String(clipped);
  }

  function renderRunControls() {
    $('.dryRun').checked = Boolean(state.automation.dryRun);
    $('.delay').value = String(state.automation.clickDelay);
    $('.maxActions').value = String(state.automation.maxActions);
    $('.retries').value = String(state.automation.retryAttempts);

    $('.start').disabled = running || !activeModule;
    $('.stop').disabled = !running;
    $('.start').textContent = running
      ? (state.automation.dryRun ? `Previewing · ${runStats.previewed}` : `Clipping · ${runStats.acted}`)
      : (state.automation.dryRun ? 'Run dry preview' : 'Start clipping');

    const labels = {
      idle: 'Idle',
      preview: 'Preview running',
      running: 'Running',
      'preview-complete': 'Preview complete',
      complete: 'Complete',
      stopped: 'Stopped',
      error: 'Stopped on error'
    };
    $('.runStatus').textContent = labels[runStatus] || runStatus;
  }

  function render() {
    renderHeader();
    renderStats();
    renderGroups();
    renderTerms();
    renderCoupons();
    renderActivity();
    renderRunControls();
    app.classList.toggle('minimized', state.minimized);
    $('.minimize').textContent = state.minimized ? '+' : '−';
  }

  async function addCurrentTerm() {
    if (!activeModule) return;

    const input = $('.keywordInput');
    const value = normalize(input.value).toLowerCase();
    if (!value) return;

    const moduleState = getModuleState(activeModule);
    const key = activeRuleTab === 'always' ? 'alwaysTerms' : 'blockedTerms';

    if (!moduleState[key].includes(value)) {
      moduleState[key].push(value);
      await persist();
    }

    input.value = '';
    refreshData();
  }

  $('.search').addEventListener('input', renderCoupons);
  $('.addTerm').addEventListener('click', addCurrentTerm);
  $('.keywordInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') addCurrentTerm();
  });

  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      activeRuleTab = tab.dataset.ruleTab;
      for (const candidate of $$('.tab')) {
        candidate.classList.toggle('active', candidate === tab);
      }
      $('.ruleHint').textContent = activeRuleTab === 'always' ? 'Overrides exclusions' : 'Never clip';
      $('.keywordInput').placeholder = activeRuleTab === 'always' ? 'e.g. General Mills' : 'e.g. formula';
      renderTerms();
    });
  }

  $('.dryRun').addEventListener('change', async event => {
    state.automation.dryRun = event.target.checked;
    await persist();
    renderRunControls();
  });

  async function saveNumericSetting(selector, key, { min, max, fallback }) {
    const raw = Number($(selector).value);
    state.automation[key] = Number.isFinite(raw)
      ? Math.min(max, Math.max(min, raw))
      : fallback;
    await persist();
    renderRunControls();
  }

  $('.delay').addEventListener('change', () => saveNumericSetting('.delay', 'clickDelay', {
    min: 250,
    max: 5000,
    fallback: 550
  }));

  $('.maxActions').addEventListener('change', () => saveNumericSetting('.maxActions', 'maxActions', {
    min: 1,
    max: 1000,
    fallback: 300
  }));

  $('.retries').addEventListener('change', () => saveNumericSetting('.retries', 'retryAttempts', {
    min: 1,
    max: 4,
    fallback: 2
  }));

  $('.start').addEventListener('click', startRun);
  $('.stop').addEventListener('click', stopRun);

  $('.minimize').addEventListener('click', async () => {
    state.minimized = !state.minimized;
    await persist();
    render();
  });

  GM_registerMenuCommand('Coupon Pilot: Open panel', async () => {
    state.minimized = false;
    await persist();
    render();
  });

  GM_registerMenuCommand('Coupon Pilot: Dry run', async () => {
    state.automation.dryRun = true;
    await persist();
    startRun();
  });

  GM_registerMenuCommand('Coupon Pilot: Start clipping', async () => {
    state.automation.dryRun = false;
    await persist();
    startRun();
  });

  const observer = new MutationObserver(() => scheduleRefresh(220));
  observer.observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleRefresh(350);
    }
  }, 500);

  refreshData();
})();
