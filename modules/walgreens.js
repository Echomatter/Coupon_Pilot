(function registerWalgreensModule(global) {
  'use strict';

  global.CouponPilotModuleFactories ??= [];
  global.CouponPilotModuleFactories.push(api => {
    const { apiVersion, ITEM_STATUS, normalize, textOf, visible, isUsableControl, waitFor, summarizeHealth } = api;
    const offerPrefix = 'walgreens:';
    return {
      apiVersion,
      id: 'walgreens',
      name: 'Walgreens',
      description: 'Coupons and rebates',
      defaultBlockedGroups: {
        Baby: ['baby', 'diaper', 'diapers', 'formula', 'infant', 'toddler'],
        Pet: ['dog food', 'cat food', 'dog treat', 'cat treat', 'pet treat', 'litter'],
        Beauty: ['makeup', 'cosmetic', 'mascara', 'foundation', 'hair color'],
        Supplements: ['vitamin', 'supplement', 'probiotic'],
        Household: ['laundry', 'detergent', 'dishwasher', 'trash bag', 'air freshener']
      },
      matches() { return location.hostname === 'www.walgreens.com' && /^\/offers\/offers\.jsp$/i.test(location.pathname); },
      controlText(element) { return normalize(element?.innerText || element?.textContent); },
      accessibleName(element) { return normalize(element?.getAttribute?.('aria-label') || element?.getAttribute?.('title')); },
      hasOfferControlLabel(element) { const text = this.controlText(element); const name = this.accessibleName(element); return /^(clip|clip coupon|clip rebate|clipped|coupon clipped|rebate clipped|remove coupon|remove rebate|unclip)$/i.test(text) || /^(clip coupon|clip rebate|coupon clipped|rebate clipped|remove coupon|remove rebate)$/i.test(name); },
      isOfferControl(element) { return visible(element) && this.hasOfferControlLabel(element); },
      controlStatus(element) { if (!visible(element)) return ITEM_STATUS.AMBIGUOUS; const label = `${this.controlText(element)} ${this.accessibleName(element)}`; if (/\bclipped\b|\bunclip\b|\bremove (?:coupon|rebate)\b/i.test(label)) return ITEM_STATUS.CLIPPED; const available = /^(clip|clip coupon|clip rebate)$/i.test(this.controlText(element)) || /^(clip coupon|clip rebate)$/i.test(this.accessibleName(element)); return available && isUsableControl(element) ? ITEM_STATUS.AVAILABLE : ITEM_STATUS.AMBIGUOUS; },
      offerControlsWithin(element, { visibleOnly = true } = {}) { return [...element.querySelectorAll('button, a, [role="button"]')].filter(control => visibleOnly ? this.isOfferControl(control) : this.hasOfferControlLabel(control)); },
      findCard(control) { const card = control?.closest?.('[coupon-id]'); if (!card || !normalize(card.getAttribute('coupon-id'))) return null; const controls = this.offerControlsWithin(card); return controls.length === 1 && controls[0] === control ? card : null; },
      itemId(card) { const offerId = normalize(card?.getAttribute?.('coupon-id')); return offerId ? `${offerPrefix}${offerId}` : null; },
      describedText(control) { const ids = normalize(control?.getAttribute?.('aria-describedby')).split(' ').filter(Boolean); return ids.map(id => textOf(document.getElementById(id))).filter(Boolean); },
      discoverItems() { const byId = new Map(); for (const card of document.querySelectorAll('[coupon-id]')) { const controls = this.offerControlsWithin(card); if (controls.length !== 1) continue; const control = controls[0]; if (this.findCard(control) !== card) continue; const id = this.itemId(card); if (!id) continue; const text = normalize(card.innerText || card.textContent); if (!text) continue; const described = this.describedText(control); const fallbackTitle = text.split('\n').map(line => normalize(line)).filter(Boolean).filter(line => !/^(clip|clip coupon|clip rebate|shop|view details)$/i.test(line)).slice(0, 3).join(' · '); const title = normalize(described.slice(0, 3).join(' · ') || fallbackTitle || text.slice(0, 140)).slice(0, 180); const item = { id, text, title, element: card, control, status: this.controlStatus(control) }; const previous = byId.get(id); if (!previous || (previous.status === ITEM_STATUS.AMBIGUOUS && item.status !== ITEM_STATUS.AMBIGUOUS)) byId.set(id, item); } return [...byId.values()]; },
      findCardById(id) { const offerId = id.startsWith(offerPrefix) ? id.slice(offerPrefix.length) : ''; return offerId ? [...document.querySelectorAll('[coupon-id]')].find(card => card.getAttribute('coupon-id') === offerId) || null : null; },
      availableFilterActive() { return Boolean(document.querySelector('input#available[type="radio"]:checked')); },
      findLoadMore() { return [...document.querySelectorAll('main button, main a, main [role="button"]')].find(element => isUsableControl(element) && /^(load more|show more|more offers|more coupons)$/i.test(textOf(element))) || null; },
      getItem(id) { return this.discoverItems().find(item => item.id === id) || null; },
      async perform(id) { const current = this.getItem(id); if (!current || current.status !== ITEM_STATUS.AVAILABLE || !current.control?.isConnected) throw new Error('Walgreens offer is no longer safely actionable'); current.control.scrollIntoView({ behavior: 'smooth', block: 'center' }); current.control.focus({ preventScroll: true }); current.control.click(); },
      async verify(id, { timeout, signal }) { return Boolean(await waitFor(() => { const card = this.findCardById(id); if (!card) return this.availableFilterActive(); const controls = this.offerControlsWithin(card, { visibleOnly: false }); if (!controls.length) return this.availableFilterActive(); return controls.some(control => this.controlStatus(control) === ITEM_STATUS.CLIPPED); }, { timeout, interval: 180, signal })); },
      healthCheck(items = this.discoverItems()) { return summarizeHealth(items); }
    };
  });
})(window);
