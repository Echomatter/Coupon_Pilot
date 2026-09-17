# Install Coupon Pilot

Coupon Pilot now installs in two pieces: one stable base userscript and whichever local retailer modules you choose.

## 1. Build and install the base

From the repository root:

```bash
node scripts/build.mjs
```

Copy the complete contents of `coupon-pilot.user.js` into the existing Coupon Pilot entry in Tampermonkey and save it. The base uses `@match *://*/*` so independently installed modules can support future retailer sites. It stays hidden on pages with no matching module.

## 2. Install a local module

1. Open any normal web page.
2. Open the Tampermonkey extension menu.
3. Under Coupon Pilot, choose **Coupon Pilot: Manage modules**.
4. In the panel, click **Browse for local module…**.
5. Select one of these files:
   - `modules/harris-teeter.js`
   - `modules/lowes-foods.js`
   - `modules/walgreens.js`
6. Check the displayed module name and version, then approve the trusted-code warning.
7. Open or reload the retailer coupon page.

You can also choose **Coupon Pilot: Install local module…** directly from the Tampermonkey script menu.

## 3. Verify safely

Keep **Dry run** enabled, run the preview, and inspect its classifications before live clipping. The module manager can disable or remove a module without changing the base script. Removing a module keeps its Coupon Pilot rules and run history so reinstalling it restores the configuration.

## Updating

- **Base update:** rebuild and replace `coupon-pilot.user.js`. Installed modules remain in Tampermonkey storage.
- **Module update:** browse to the changed `.js` module again. Matching `@id` values are updated in place.

The panel records a SHA-256 digest with each installed source and includes module metadata—never source code—in copied debug reports.
