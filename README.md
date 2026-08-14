# Coupon Pilot

Coupon Pilot is a small Tampermonkey userscript platform for automating repetitive coupon-clipping work in the browser.

The codebase is modular even though installation stays simple:

- `src/coupon-pilot.shell.js` owns UI, rules, persistence, run controls, retries, diagnostics, and module registration.
- `modules/*.js` contain retailer-specific DOM knowledge.
- `scripts/build.mjs` combines those sources into the single distributable `coupon-pilot.user.js`.
- Tampermonkey installs only `coupon-pilot.user.js`.

The first adapter targets **Harris Teeter digital coupons**.

## Current behavior

Coupon Pilot includes a compact control panel, Dry Run, exclusion and always-clip rules, persistent local settings, stable coupon identities, bounded retry, click verification, a circuit breaker, abortable runs, lazy-load handling, and module health checks.

The engine remains deliberately fail-closed:

`discover -> classify -> act -> verify -> record`

If Coupon Pilot cannot confidently identify or verify a coupon action, it skips or stops rather than clicking blindly.

## Install

Because the repository is private, manual Tampermonkey installation remains the reliable path:

1. Run `node scripts/build.mjs` after source changes.
2. Copy `coupon-pilot.user.js`.
3. Create or replace the Coupon Pilot script in Tampermonkey.
4. Reload the Harris Teeter coupon page.
5. Run Dry Run before the first live run after an update.

See `docs/INSTALL.md` for details.

## Development

Edit the shell or retailer modules, then rebuild:

```bash
node scripts/build.mjs
node scripts/build.mjs --check
node tests/static-checks.mjs
node --check coupon-pilot.user.js
```

Do not hand-edit the generated `coupon-pilot.user.js`; CI verifies that it matches the modular sources.

## Add another retailer

Create another file under `modules/` that registers a module factory, add it to `scripts/build.mjs`, add the retailer `@match` metadata to the shell, rebuild, and test in Dry Run.

See `docs/MODULES.md` for the adapter contract.
