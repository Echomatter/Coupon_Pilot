# Site modules

Coupon Pilot keeps retailer-specific DOM knowledge behind a small adapter boundary. The shell owns the control panel, rule evaluation, persistence, throttling, cancellation, retries, activity reporting, and run history.

## Module responsibilities

A retailer module should provide these behaviors:

```js
{
  id: 'retailer-id',
  name: 'Retailer Name',
  description: 'Digital coupons',

  defaultBlockedGroups: {
    Baby: ['baby', 'diaper', 'formula']
  },

  matches() {},
  discoverItems() {},
  findLoadMore() {},
  perform(id) {},
  verify(id, { timeout, signal }) {},
  healthCheck() {}
}
```

The registry validates the required module members when an adapter is registered.

### `matches()`

Return `true` only when the current URL is a page the adapter understands.

Keep matching narrow. A module should not activate on an entire retailer site when it only knows the coupon page.

### `discoverItems()`

Return the coupons currently represented in the DOM.

Each item should have this shape:

```js
{
  id: 'stable-retailer-id',
  text: 'normalized searchable coupon text',
  title: 'short user-facing description',
  element: couponCardElement,
  control: clipButtonElement,
  status: 'available' // available | clipped | ambiguous
}
```

The `id` is important. Do not use the DOM node itself as identity because React/Vue/etc. may replace the node during rerenders. Prefer a retailer coupon/offer ID when the page exposes one; otherwise derive a deterministic hash from stable coupon text.

A control should be marked `available` only when the adapter can identify the intended coupon action confidently. Disabled, hidden, or otherwise unclear controls should be `ambiguous`, not assumed to be clipped.

### `findLoadMore()`

Return the site's visible **Load more / Show more** control or `null`.

This action is allowed during Dry Run because it only exposes more coupons; Dry Run prevents coupon clipping, not navigation through the coupon list.

### `perform(id)`

Resolve the current DOM representation for the coupon immediately before acting, then invoke the visible clip control.

Do not keep a stale button reference across long waits. Reconfirm that the control is connected and still reports `available` immediately before the click.

### `verify(id, { timeout, signal })`

Verify that the site visibly accepted the action. Prefer an explicit state transition such as `Clip` -> `Clipped`.

A click is **not** considered successful just because `.click()` returned. Coupon Pilot's default posture is fail-closed: an item merely disappearing from the currently rendered DOM is not sufficient proof by itself, because virtualized lists and rerenders can also remove nodes.

If a retailer genuinely removes a successfully clipped coupon, that behavior should be verified with a retailer-specific signal before disappearance is treated as success.

### `healthCheck()`

Return a lightweight diagnostic:

```js
{
  level: 'ready', // ready | caution | done | warning
  message: '42 ready to clip',
  found: 65,
  available: 42,
  clipped: 23,
  ambiguous: 0
}
```

`caution` can be used when safe actions exist but some controls are intentionally being skipped as ambiguous. `warning` should be used when the module cannot safely operate.

The shell can refuse to start when the page does not resemble what the module expects or when no safely actionable coupons are available.

## Selector guidance

Use the most semantic/stable signal available, in this order when practical:

1. retailer-provided coupon/offer IDs;
2. `data-testid`, `data-qa`, or similar semantic attributes;
3. accessible role/name or exact visible action text;
4. conservative structural fallbacks.

Avoid long CSS chains tied to presentation markup.

When selecting a coupon card, validate that the candidate container owns the expected coupon control rather than accepting a broad parent that happens to contain several coupon cards.

Never use a generic `Add` label as an alias for `Clip` on a retail site. Coupon Pilot should prefer a false negative over clicking an unrelated cart control.

## Rule evaluation

The shell applies rules after `discoverItems()` returns normalized item text:

1. custom **Always clip** keyword match -> eligible;
2. enabled exclusion-group keyword match -> blocked;
3. custom **Never clip** keyword match -> blocked;
4. otherwise -> eligible.

A future module may add structured fields (brand, category, expiration, coupon value) without changing this basic contract.

## Adding a site

1. Add the retailer domain to the userscript metadata with a narrow `@match`.
2. Register the adapter with `registerModule({...})`.
3. Start with discovery + Dry Run only.
4. Confirm stable item identity across lazy loading and rerenders.
5. Confirm broad container selectors cannot swallow multiple coupon cards.
6. Add `perform()` and `verify()` only after selectors are reliable.
7. Test explicit successful and failed post-click state transitions.
8. Test the module health check in these states:
   - normal loaded coupons;
   - all visible coupons already clipped;
   - no coupons loaded yet;
   - retailer markup changed / action is ambiguous.

## Deliberate non-goals

Site modules should stay focused on the visible, logged-in retailer UI and repetitive coupon work. They should not add mechanisms for bypassing retailer access controls or purchase limits.
