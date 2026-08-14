# Install Coupon Pilot

Coupon Pilot is developed as modular JavaScript but distributed as **one Tampermonkey userscript**. You do not install the retailer modules separately.

## Build

From the repository root:

```bash
node scripts/build.mjs
```

This combines `src/coupon-pilot.shell.js` and `modules/harris-teeter.js` into `coupon-pilot.user.js`.

The root userscript is generated output. Edit the source files, not the generated file.

## Install in Tampermonkey

Because this repository is private, manual installation is the reliable path:

1. Build the userscript.
2. Open `coupon-pilot.user.js`.
3. Copy the complete file.
4. In Tampermonkey, create a new script or open the existing Coupon Pilot script.
5. Replace its contents and save.
6. Confirm Coupon Pilot is enabled.
7. Reload the Harris Teeter coupon page.

Keep **Dry run** enabled after installation or a retailer-site change. Configure exclusions and keyword rules, run the preview, inspect the classifications, then disable Dry Run for a live clip run.

If Coupon Pilot reports ambiguous controls after a retailer-site change, click the **🐞** button in the footer. It copies a debug report containing version, page, counts, settings, and a small sample of ambiguous control labels. The report excludes custom keyword text and account information.

## Updating

After changing the shell or a module:

```bash
node scripts/build.mjs
node scripts/build.mjs --check
node tests/static-checks.mjs
```

Then replace the installed Tampermonkey script with the rebuilt `coupon-pilot.user.js`.

Coupon Pilot has no backend. Preferences and run settings are stored in Tampermonkey storage for the browser profile where it is installed.
