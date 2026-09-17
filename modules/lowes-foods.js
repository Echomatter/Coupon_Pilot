// ==CouponPilotModule==
// @id           lowes-foods
// @name         Lowes Foods
// @version      1.0.0
// @api          3
// @description  Digital coupons
// @match        https://shop.lowesfoods.com/shop/coupons*
// @match        https://shop.lowesfoods.com/promotions
// @match        https://shop.lowesfoods.com/promotions?*
// ==/CouponPilotModule==

(function registerLowesFoodsModule(CouponPilot) {
  'use strict';

  CouponPilot.register(api => {
    const { apiVersion, ITEM_STATUS, normalize, textOf, visible, isUsableControl, waitFor, summarizeHealth } = api;
    const itemPrefix = 'lowes-foods:';
    const cardSelector = '[role="feed"] [role="article"].c-card-wrapper';
    const controlSelector = 'button.c-button--offer-clip';
    const detailsSelector = 'a.c-card__link--offer[href*="/promotions/"]';

    return {
      apiVersion,
      controlText(element) { return normalize(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label')); },
      hasOfferControlLabel(element) { return /^(clip!?|clipped!?|redeemed!?)$/i.test(this.controlText(element)); },
      isOfferControl(element) { return visible(element) && element?.matches?.(controlSelector) && this.hasOfferControlLabel(element); },
      offerControlsWithin(card, { visibleOnly = true } = {}) {
        return [...card.querySelectorAll(controlSelector)].filter(control => this.hasOfferControlLabel(control) && (!visibleOnly || visible(control)));
      },
      findCard(control) {
        const card = control?.closest?.(cardSelector);
        if (!card) return null;
        const controls = this.offerControlsWithin(card);
        return controls.length === 1 && controls[0] === control ? card : null;
      },
      offerId(card) {
        const href = card?.querySelector?.(detailsSelector)?.getAttribute?.('href') || '';
        return href.match(/\/(\d+)\/?(?:[?#].*)?$/)?.[1] || null;
      },
      itemId(card) { const offerId = this.offerId(card); return offerId ? `${itemPrefix}${offerId}` : null; },
      isClippedCard(card) {
        return Boolean(card?.querySelector?.('.offer-card__corner-icon--clipped, use[href$="#icon-clipped"]'));
      },
      controlStatus(control, card = control?.closest?.(cardSelector)) {
        const label = this.controlText(control);
        if (this.isClippedCard(card) || /^clipped!?$/i.test(label) || /^redeemed!?$/i.test(label)) return ITEM_STATUS.CLIPPED;
        if (/^clip!?$/i.test(label) && isUsableControl(control)) return ITEM_STATUS.AVAILABLE;
        return ITEM_STATUS.AMBIGUOUS;
      },
      itemTitle(card) {
        const title = textOf(card?.querySelector?.('.c-card__content__title--offer'));
        if (title) return title;
        return normalize(card?.querySelector?.(detailsSelector)?.getAttribute?.('aria-label')).replace(/^go to offer details page for\s+/i, '');
      },
      discoverItems() {
        const items = [];
        const seen = new Set();
        for (const card of document.querySelectorAll(cardSelector)) {
          const controls = this.offerControlsWithin(card);
          if (controls.length !== 1) continue;
          const control = controls[0];
          if (this.findCard(control) !== card) continue;
          const id = this.itemId(card);
          const text = textOf(card);
          const title = this.itemTitle(card);
          if (!id || seen.has(id) || !text || !title) continue;
          seen.add(id);
          items.push({ id, text, title: title.slice(0, 180), element: card, control, status: this.controlStatus(control, card) });
        }
        return items;
      },
      findCardById(id) {
        const offerId = id.startsWith(itemPrefix) ? id.slice(itemPrefix.length) : '';
        return offerId ? [...document.querySelectorAll(cardSelector)].find(card => this.offerId(card) === offerId) || null : null;
      },
      getItem(id) {
        const card = this.findCardById(id);
        if (!card) return null;
        const controls = this.offerControlsWithin(card, { visibleOnly: false });
        if (controls.length !== 1) return null;
        const control = controls[0];
        const text = textOf(card);
        const title = this.itemTitle(card);
        return text && title ? { id, text, title: title.slice(0, 180), element: card, control, status: this.controlStatus(control, card) } : null;
      },
      async perform(id) {
        const current = this.getItem(id);
        if (!current || current.status !== ITEM_STATUS.AVAILABLE || !current.control?.isConnected) throw new Error('Lowes Foods coupon is no longer safely actionable');
        current.control.scrollIntoView({ behavior: 'smooth', block: 'center' });
        current.control.focus({ preventScroll: true });
        current.control.click();
      },
      async verify(id, { timeout, signal }) {
        return Boolean(await waitFor(() => this.getItem(id)?.status === ITEM_STATUS.CLIPPED, { timeout, interval: 180, signal }));
      },
      healthCheck(items = this.discoverItems()) {
        const summary = summarizeHealth(items);
        const signInRegion = document.querySelector('[aria-label="Sign in or Register"]');
        if (items.length && !summary.available && /please sign in to clip coupons/i.test(textOf(signInRegion))) {
          return { ...summary, level: 'warning', message: 'Sign in to Lowes Foods to clip coupons' };
        }
        return summary;
      }
    };
  });
})(CouponPilot);
