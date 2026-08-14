# Site modules

Coupon Pilot keeps retailer-specific DOM knowledge behind a small adapter boundary.

The shell owns the control panel, rule evaluation, persistence, throttling, cancellation, retries, activity reporting, and run history. Retailer modules own URL matching, coupon discovery, action controls, verification, lazy-load discovery, and site health.

## Source layout

```text
src/coupon-pilot.shell.js
modules/harris-teeter.js
scripts/build.mjs
coupon-pilot.user.js       # generated distributable
```

Tampermonkey still installs only `coupon-pilot.user.js`.

## Registration pattern

A module file registers a factory before the shell starts:

```js
globalThis.CouponPilotModuleFactories ??= [];
globalThis.CouponPilotModuleFactories.push(api => ({
  apiVersion: 1,
  id: 'retailer-id',
  name: 'Retailer Name',
  matches() {},
  discoverItems() {},
  perform(id) {},
  verify(id, { timeout, signal }) {},
  healthCheck(items) {}
}));
```

The shell passes stable shared helpers through `api`. The registry rejects unsupported API versions, duplicate IDs, missing names, and required members that are not functions.

`healthCheck(items)` receives the already-discovered items to avoid a redundant DOM scan.

If `findLoadMore()` is implemented, scope it to the coupon experience rather than accepting a generic page-wide “Show more” control.

Prefer retailer IDs and semantic attributes over presentation-specific CSS. Never treat a generic **Add** button as a coupon clip action.
