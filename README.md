# Coupon Pilot

Coupon Pilot is a small Tampermonkey userscript platform for automating repetitive coupon-clipping work in the browser.

It is intentionally built around **site adapters**, not one giant retailer-specific script. The shell owns the UX, rules, persistence, run controls, diagnostics, retries, and verification. A retailer module only needs to know how to discover its coupon cards and perform the site's supported clip action.

## Current status

The first adapter targets **Harris Teeter digital coupons**.

Coupon Pilot currently includes:

- a compact Shadow DOM control panel that retailer CSS cannot easily break;
- Start, Stop, and Dry Run controls;
- strict `Clip` matching — it never treats a generic `Add` button as a coupon action;
- quick exclusion groups such as Baby, Pet, Beauty, Supplements, and Household;
- custom **Never clip** keywords;
- custom **Always clip** keywords that override exclusions;
- live search across loaded coupons;
- persistent per-site settings using Tampermonkey storage;
- stable coupon IDs to avoid duplicate work across rerenders;
- click verification instead of assuming a click succeeded;
- bounded retry and a circuit breaker after repeated failures;
- abortable runs for immediate Stop behavior;
- lazy-load handling and DOM mutation refreshes;
- a site health check before automation runs;
- an adapter registry for adding more retailers without rebuilding the UI.

## Quick install

Because this repository is private, **manual Tampermonkey installation is the reliable path**:

1. Install Tampermonkey.
2. Open [`coupon-pilot.user.js`](./coupon-pilot.user.js).
3. Copy the complete script.
4. In Tampermonkey, choose **Create a new script**.
5. Replace the template with Coupon Pilot and save it.
6. Reload the Harris Teeter digital-coupons page.
7. Leave **Dry run** enabled and choose **Run dry preview** before the first live run.

See **[docs/INSTALL.md](./docs/INSTALL.md)** for browser setup, first-run instructions, updating, rule precedence, and troubleshooting.

Coupon Pilot is installed as one userscript; there is no build step or backend.

## How the rules work

Rules are intentionally simple and predictable:

1. **Always clip** terms win first.
2. Enabled exclusion groups are checked next.
3. Custom **Never clip** terms are checked next.
4. Everything else is eligible.

Matching is case-insensitive and currently uses normalized coupon-card text.

Example:

- `Baby` exclusion enabled
- Never clip: `formula`
- Always clip: `Gerber`

A Gerber coupon still clips even if its card also contains `baby`.

## Safety / reliability model

Coupon Pilot operates the visible, logged-in retailer UI. It does not include CAPTCHA solving, fingerprint spoofing, proxy rotation, queue bypassing, hidden purchase automation, or other anti-detection machinery.

The engine prefers observable browser actions:

`discover -> classify -> act -> verify -> record`

If a site changes enough that Coupon Pilot can no longer verify its actions, the run stops instead of continuing to click blindly.

A fresh installation defaults to **Dry run = on**. The intended workflow after installation or a retailer redesign is:

`dry preview -> inspect classifications -> live run`

## Add another retailer

See [`docs/MODULES.md`](./docs/MODULES.md).

The shell is reusable. A new retailer adapter supplies a small contract for:

- URL matching;
- coupon discovery;
- stable item identity;
- clip action;
- post-click verification;
- optional lazy-load control;
- health reporting.

## Development philosophy

Coupon Pilot stays deliberately small:

- no framework;
- no backend;
- no build pipeline required for the current version;
- retailer-specific logic stays isolated;
- user preferences are local to the userscript;
- automation is throttled and observable.

The distributable app is the single `coupon-pilot.user.js` file.
