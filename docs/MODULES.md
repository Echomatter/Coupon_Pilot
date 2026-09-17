# Coupon Pilot module contract

API version 3 separates the stable shell from retailer-specific code. A module is one standalone JavaScript file installed through the Coupon Pilot panel. It is not added to `coupon-pilot.user.js`.

The shell owns UI, module persistence, rules, throttling, cancellation, retries, activity, diagnostics, and run history. A module owns offer discovery, exact action controls, verification, lazy loading, and retailer health.

## Required file header

Every module starts with a parseable manifest. `@id`, `@name`, `@version`, `@api`, and at least one `@match` are required. Repeat `@match` for additional pages.

```js
// ==CouponPilotModule==
// @id           retailer-id
// @name         Retailer Name
// @version      1.0.0
// @api          3
// @description  Digital coupons
// @match        https://www.example.com/coupons/*
// ==/CouponPilotModule==
```

IDs use lowercase letters, numbers, and hyphens. Versions use semantic versioning. Match patterns are declarative glob patterns; the shell decides which single module is active for the current URL. If multiple enabled modules match, Coupon Pilot stops and asks the user to disable the extra one.

## Registration

The file must call `CouponPilot.register` exactly once:

```js
(function registerExampleModule(CouponPilot) {
  'use strict';

  CouponPilot.register(api => {
    const { apiVersion, ITEM_STATUS, summarizeHealth } = api;
    return {
      apiVersion,
      discoverItems() {},
      async perform(id) {},
      async verify(id, { timeout, signal }) {},
      healthCheck(items) { return summarizeHealth(items); }
    };
  });
})(CouponPilot);
```

The factory receives a frozen API and returns an adapter. Required functions are `discoverItems`, `perform`, `verify`, and `healthCheck`. `findLoadMore` is optional. Identity, version, description, and page matching come from the header rather than executable adapter code.

The frozen API supplies:

- `apiVersion` and `ITEM_STATUS`
- `normalize`, `textOf`, and `safeCouponIdentity`
- `visible`, `controlLabel`, and `isUsableControl`
- `hash`, `waitFor`, and `summarizeHealth`

## Discovered item contract

`discoverItems()` returns unique items:

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

Use retailer-provided offer identifiers when possible. The shell rejects duplicate IDs, invalid states, and missing text or titles.

Rules and quick-exclusion groups are owned by the shell and shared across every retailer module. Modules may optionally add `url`, `productUrl`, or a flat `metadata` object to an item. Rule matching also inspects links, URL path/query names, accessible labels, titles, and image alt text within the coupon card.

## Fail-closed requirements

- Match explicit coupon controls; never accept generic **Add**, **Shop**, or page-wide buttons.
- Require one unambiguous action control per card.
- Re-resolve the item by stable ID immediately before clicking.
- Mark unfamiliar, hidden, disabled, or conflicting controls as `AMBIGUOUS`.
- Verify a retailer-specific success state. A click alone is never success.
- Respect the supplied timeout and abort signal.
- Scope `findLoadMore()` to the coupon experience.

## Development loop

1. Copy the nearest existing retailer module.
2. Give it a unique header identity, version, and page match.
3. Implement only retailer-specific discovery/action behavior.
4. Add the filename to `modules/manifest.mjs` so repository contract tests include it.
5. Run `node tests/module-contracts.mjs` and `node tests/static-checks.mjs`.
6. In Coupon Pilot, browse to the local file. Selecting it again updates the installed copy by `@id`.
7. Reload the retailer page and test in Dry Run.

Modules are trusted code and execute with the shell's page access. The manifest and contract checks catch compatibility and shape errors; they are not a security sandbox.
