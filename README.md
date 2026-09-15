# Coupon Pilot

Coupon Pilot is a Tampermonkey userscript for applying digital coupons with a retailer-specific, independently installable module system.

It is designed for local, reviewable automation: the shared shell handles safety, state, and diagnostics while each retailer module contains only the page-specific behavior.

- `coupon-pilot.user.js` is the generated base userscript. It owns the UI, module manager, shared cross-retailer rules, persistence, run controls, retries, diagnostics, and safety checks.
- `modules/*.js` are standalone local module files. Each owns only one retailer's URL patterns and DOM behavior.
- Installed module source is validated and stored in Tampermonkey storage. Updating the base script does not erase installed modules.

Included modules:

- **Harris Teeter**
- **Lowes Foods**
- **Walgreens**

Modules are local files and are not compiled into the base userscript. This keeps retailer updates independent from the shell.

## Quick start

1. Install or replace the Tampermonkey script with `coupon-pilot.user.js`.
2. Accept its broad website access. The shell needs this so modules can target supported retailer pages without rebuilding the base.
3. Open the Tampermonkey menu and choose **Coupon Pilot: Manage modules**.
4. Click **Browse for local module…** and select a trusted file such as `modules/walgreens.js`.
5. Confirm the module, reload its coupon page, and run **Dry Run** first.

See `docs/INSTALL.md` for the complete local workflow and `docs/MODULES.md` for the API v3 contract.

## Safety model

Coupon Pilot is fail-closed:

`discover -> classify -> act -> verify -> record`

Modules are executable JavaScript, not data files. Before saving a module, the manager validates its identity, version, API compatibility, registration count, and adapter surface. These checks do not make untrusted JavaScript safe—only install module files you trust.

## Development

Edit the shell or a standalone module, then run the focused checks:

```bash
node scripts/build.mjs
node scripts/build.mjs --check
node tests/static-checks.mjs
node tests/module-contracts.mjs
node tests/module-manager.mjs
node tests/privacy-checks.mjs
node --check coupon-pilot.user.js
```

Do not hand-edit `coupon-pilot.user.js`; it is generated from `src/coupon-pilot.shell.js`. Editing a retailer module does not require rebuilding the base script—install the changed module file through the manager again to update it.

## Project layout

```text
src/coupon-pilot.shell.js  Source for the generated userscript
coupon-pilot.user.js       Generated Tampermonkey userscript
modules/                   Standalone retailer modules
docs/                      Installation and module-contract documentation
tests/                     Static, contract, manager, and privacy checks
```
