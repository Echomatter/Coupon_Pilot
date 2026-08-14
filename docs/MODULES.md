# Coupon Pilot module contract

Coupon Pilot keeps retailer-specific DOM knowledge behind a versioned adapter boundary. The shell owns UI, rules, persistence, throttling, cancellation, retries, activity, debug reports, and run history. Modules own URL matching, offer discovery, action controls, verification, lazy loading, and retailer health.

## Source and build order

```text
src/coupon-pilot.shell.js
modules/manifest.mjs
modules/harris-teeter.js
modules/walgreens.js
scripts/build.mjs
coupon-pilot.user.js       # generated distributable
```

`modules/manifest.mjs` is the explicit module allowlist and build order. Add each new module there. Tampermonkey installs only the generated `coupon-pilot.user.js`.

## API version 2

A module file registers one factory before the shell starts:

```js
(function registerRetailerModule(global) {
  'use strict';

  global.CouponPilotModuleFactories ??= [];
  global.CouponPilotModuleFactories.push(api => ({
    apiVersion: api.apiVersion,
    id: 'retailer-id',
    name: 'Retailer Name',
    description: 'Digital coupons',
    defaultBlockedGroups: {},
    matches() {},
    discoverItems() {},
    perform(id) {},
    verify(id, { timeout, signal }) {},
    healthCheck(items) {}
  }));
})(window);
```

Required functions are `matches`, `discoverItems`, `perform`, `verify`, and `healthCheck`. Module IDs must be unique. The shell rejects unsupported API versions, invalid default rule groups, duplicate item IDs, invalid item states, and missing item text or titles.

The frozen API object supplies:

- `apiVersion` and `ITEM_STATUS`
- `normalize`, `textOf`, and `safeCouponIdentity`
- `visible`, `controlLabel`, and `isUsableControl`
- `hash`, `waitFor`, and `summarizeHealth`

## Discovered item contract

`discoverItems()` returns an array of unique items:

```js
{
  id: 'retailer:stable-offer-id',
  text: 'Complete searchable and classifiable offer text',
  title: 'Short user-facing title',
  element: couponCardElement,
  control: actionControlElement,
  status: ITEM_STATUS.AVAILABLE // AVAILABLE, CLIPPED, or AMBIGUOUS
}
```

IDs should use retailer-provided offer identifiers. Text hashes are a fallback only. `element` is highlighted and scrolled into view; `control` is the exact element that `perform` may click.

## Fail-closed lifecycle

Every module must preserve:

`discover -> classify -> act -> verify -> record`

- Match explicit coupon controls; never accept generic **Add**, **Shop**, or page-wide buttons.
- Require one unambiguous action control per card.
- Re-resolve the item by stable ID immediately before clicking.
- Mark unfamiliar, hidden, disabled, or conflicting controls as `AMBIGUOUS`.
- Verify a retailer-specific success state. A click alone is never success.
- Respect the supplied timeout and abort signal.
- Scope `findLoadMore()` to the coupon experience when implemented.

`healthCheck(items)` receives already-validated discovered items. Most modules should return `summarizeHealth(items)`.

## Debug and privacy

The shell's 🐞 button includes module ID, health, item counts, settings, and a limited sample of ambiguous control labels. It excludes account data and custom rule text. Module titles and control labels should contain offer information only.

## Adding a retailer

1. Inspect the live coupon page without clicking offers.
2. Identify stable card IDs, exact action labels, available/clipped states, and lazy-load behavior.
3. Add `modules/<retailer>.js` and register it in `modules/manifest.mjs`.
4. Add the retailer URL to userscript `@match` metadata.
5. Add module contract checks for matching and control states.
6. Rebuild, run Dry Run on the live page, and inspect the debug report.
7. Test live actions only with explicit authorization and bounded `Max` settings.
