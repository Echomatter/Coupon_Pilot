(function registerHarrisTeeterModule(global) {
  'use strict';

  global.CouponPilotModuleFactories ??= [];
  global.CouponPilotModuleFactories.push(api => {
    const { apiVersion, ITEM_STATUS, normalize, textOf, visible, isUsableControl, hash, waitFor, safeCouponIdentity, summarizeHealth } = api;
    return {
      apiVersion,
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
      controlStatus(element) { if (!visible(element)) return ITEM_STATUS.AMBIGUOUS; const visibleText = normalize(element.innerText || element.textContent); const accessibleName = normalize(element.getAttribute('aria-label') || element.getAttribute('title')); const label = `${visibleText} ${accessibleName}`; if (/\bclipped\b|\bunclip\b|\bremove coupon\b/i.test(label)) return ITEM_STATUS.CLIPPED; const explicitClip = /^clip$/i.test(visibleText) || /^clip(?:\s+for\s+coupon:|\s+coupon\b|$)/i.test(accessibleName); return explicitClip && isUsableControl(element) ? ITEM_STATUS.AVAILABLE : ITEM_STATUS.AMBIGUOUS; },
      couponControlsWithin(element) { return [...element.querySelectorAll('button, a, [role="button"]')].filter(control => this.isCouponControl(control)); },
      findCard(control) { for (const selector of ['[data-testid^="CouponCard-"]','[data-testid="coupon-grid-card"]','[data-testid*="coupon" i]','[data-qa*="coupon" i]','[data-cy*="coupon" i]','[data-component*="coupon" i]']) { const candidate = control.closest(selector); if (!candidate) continue; const text = textOf(candidate); const controls = this.couponControlsWithin(candidate); if (text.length >= 20 && text.length <= 2500 && controls.length === 1) return candidate; } let node = control.parentElement; for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) { const text = textOf(node); if (text.length < 20 || text.length > 2200) continue; if (!/\bsave\b|\bexpires?\b|\bcoupon\b|\boff\b/i.test(text)) continue; const controls = this.couponControlsWithin(node); if (controls.length === 1 && controls[0] === control) return node; } return null; },
      itemId(card) { const direct = card?.getAttribute('data-coupon-id') || card?.getAttribute('data-offer-id'); if (direct) return `ht:${direct}`; const testId = card?.getAttribute('data-testid'); const testIdMatch = testId?.match(/^CouponCard-(.+)$/i); if (testIdMatch) return `ht:${testIdMatch[1]}`; const nested = card?.querySelector('[data-coupon-id], [data-offer-id]'); const nestedId = nested?.getAttribute('data-coupon-id') || nested?.getAttribute('data-offer-id'); return nestedId ? `ht:${nestedId}` : `ht:${hash(safeCouponIdentity(textOf(card)))}`; },
      discoverItems() { const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter(control => this.isCouponControl(control)); const byId = new Map(); for (const control of controls) { const card = this.findCard(control); if (!card) continue; const text = textOf(card); if (!text) continue; const id = this.itemId(card); const status = this.controlStatus(control); const title = normalize((card.innerText || card.textContent || text).split('\n').map(line => line.trim()).filter(Boolean).filter(line => !/^(clip|clipped|unclip)$/i.test(line)).slice(0,3).join(' · ')) || text.slice(0,140); const item = { id, text, title: title.slice(0,180), element: card, control, status }; const previous = byId.get(id); if (!previous || (previous.status === ITEM_STATUS.AMBIGUOUS && status !== ITEM_STATUS.AMBIGUOUS)) byId.set(id,item); } return [...byId.values()]; },
      findLoadMore() { const couponControls = [...document.querySelectorAll('button, a, [role="button"]')].filter(control => this.isCouponControl(control)); const roots = [...new Set(couponControls.map(control => this.findCard(control)?.parentElement).filter(Boolean))]; for (const root of roots) { const candidate = [...root.querySelectorAll('button, a, [role="button"]')].find(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && /^(load more|show more|more coupons)$/i.test(textOf(element))); if (candidate) return candidate; } return null; },
      getItem(id) { return this.discoverItems().find(item => item.id === id) || null; },
      async perform(id) { const current = this.getItem(id); if (!current || current.status !== ITEM_STATUS.AVAILABLE || !current.control?.isConnected) throw new Error('Coupon is no longer safely actionable'); current.control.scrollIntoView({ behavior: 'smooth', block: 'center' }); current.control.focus({ preventScroll: true }); current.control.click(); },
      async verify(id, { timeout, signal }) { return Boolean(await waitFor(() => this.getItem(id)?.status === ITEM_STATUS.CLIPPED, { timeout, interval: 180, signal })); },
      healthCheck(items = this.discoverItems()) { return summarizeHealth(items); }
    };
  });
})(window);
