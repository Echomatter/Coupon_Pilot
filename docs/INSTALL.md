# Install Coupon Pilot

Coupon Pilot is a single Tampermonkey userscript. There is no build step, server, or separate desktop application.

## Recommended setup

The easiest setup is a Chromium browser such as Chrome or Edge with Tampermonkey installed. Firefox with Tampermonkey is also suitable.

Because this repository is private, **manual installation is the most reliable method**. A userscript manager may not be able to authenticate against GitHub's private Raw URL for automatic installation or updates.

## Install

1. Install **Tampermonkey** in your browser.
2. In this repository, open [`coupon-pilot.user.js`](../coupon-pilot.user.js).
3. Open the file's **Raw** view, or open the normal GitHub file view and copy the complete file contents.
4. Open the Tampermonkey dashboard.
5. Choose **Create a new script** (`+`).
6. Delete the template Tampermonkey created.
7. Paste the complete contents of `coupon-pilot.user.js`.
8. Save the script (`Ctrl+S` / `Cmd+S`).
9. Confirm **Coupon Pilot** is enabled in Tampermonkey.
10. Reload the Harris Teeter coupon page.

Coupon Pilot currently matches Harris Teeter pages under:

```text
https://www.harristeeter.com/*
```

The panel only becomes visible when the Harris Teeter module recognizes a coupon-page URL containing `/coupons`.

## First run

1. Sign in to Harris Teeter normally in the same browser.
2. Open the Harris Teeter digital-coupons page.
3. Wait for the coupon list to finish its initial load.
4. Coupon Pilot should appear in the lower-right corner.
5. Leave **Dry run** enabled. It is enabled by default on a fresh installation.
6. Configure any quick exclusions, such as **Baby**, or add custom **Never clip** terms.
7. Add any **Always clip** terms you want. Always-clip rules override exclusions.
8. Choose **Run dry preview**.
9. Review the results before turning Dry run off.
10. When the preview looks correct, disable **Dry run** and choose **Start clipping**.

During a dry run, Coupon Pilot does not clip coupons. Eligible coupon cards are outlined in indigo and blocked cards are outlined in amber while the loaded list and activity panel show how each item was classified.

## Rule precedence

Coupon Pilot evaluates rules in this order:

1. **Always clip** keyword matches are allowed.
2. Enabled quick-exclusion groups are blocked.
3. Custom **Never clip** keyword matches are blocked.
4. Everything else is eligible.

Keyword matching is currently case-insensitive substring matching against the normalized text of the coupon card.

## Run controls

- **Dry run** — classify and preview without clipping.
- **Delay ms** — minimum courtesy delay between coupon actions.
- **Max actions** — upper bound for one run.
- **Retries** — bounded attempts when an action cannot be verified.
- **Stop** — abort the current run immediately through the script's cancellation controller.

Coupon Pilot verifies the visible post-click state rather than counting `.click()` itself as success. Repeated verification failures trip a circuit breaker and stop the run.

## Updating

For now, treat updates as manual because the repository is private:

1. Open the current `coupon-pilot.user.js` on `main`.
2. Copy the complete file contents.
3. Open Coupon Pilot in the Tampermonkey editor.
4. Replace the old contents with the new file.
5. Save and reload the coupon page.

The current script version is displayed in the Coupon Pilot panel and in the userscript metadata header.

If the repository is made public later, `@downloadURL` / `@updateURL` can be added so Tampermonkey can update the userscript automatically.

## Troubleshooting

### The panel does not appear

Check that:

- Coupon Pilot is enabled in Tampermonkey;
- you reloaded the page after installing or editing the script;
- the page URL is a Harris Teeter coupon page containing `/coupons`;
- Tampermonkey has permission to run on `harristeeter.com`.

### `No coupon cards detected yet`

Wait for the retailer page to finish loading and retry. If the message persists after a reload, keep Dry run enabled. Harris Teeter may have changed its markup and the module may need a selector update.

### `ambiguous coupon controls detected`

Do not force a live run to work around the warning. The module intentionally fails conservatively when it cannot distinguish a coupon action confidently. Use Dry run and inspect the page before changing selectors.

### A run stops after repeated failures

That is the circuit breaker doing its job. Reload the coupon page and try a Dry run. If discovery still looks wrong, the retailer adapter should be updated rather than increasing retries indefinitely.

## Local data

Coupon Pilot has no backend. Rule preferences and run settings are stored in Tampermonkey's script storage for the browser profile where it is installed.
