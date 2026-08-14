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
