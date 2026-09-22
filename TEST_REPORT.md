# Test Report

Tested September 21, 2026.

## Catalog validation

- **PASS:** 135 active catalog products loaded.
- **PASS:** 95 Sam's Club products.
- **PASS:** 40 Walmart products.
- **PASS:** 131 supplied product photos extracted and optimized locally.
- **PASS:** 4 source products had no supplied photo and use the intentional placeholder.
- **PASS:** no duplicate product IDs.
- **PASS:** no duplicate product signatures after retailer/name/pack/size/variety normalization.
- **PASS:** every referenced local image file exists.

## Code checks

- **PASS:** `assets/app.js` JavaScript syntax check.
- **PASS:** `sw.js` JavaScript syntax check.
- **PASS:** `backend/Code.gs` JavaScript/V8 syntax check.
- **PASS:** backend email-builder smoke test grouped both retailers, rendered quantities, and produced a SHA-256 duplicate key.

## Phone-size workflow test

Viewport: **390 × 844 px**.

- **PASS:** 135 products rendered.
- **PASS:** no page-level horizontal overflow.
- **PASS:** category chips rendered as a horizontally scrollable control.
- **PASS:** searching `Monster` reduced the catalog to 22 matching products.
- **PASS:** Add selected a product.
- **PASS:** quantity increase changed the request to 2 units.
- **PASS:** running cart showed `1 selected · 2 total units`.
- **PASS:** order drawer opened correctly.
- **PASS:** store selection and employee name entry worked.
- **PASS:** per-product note editing worked in the review drawer.
- **PASS:** clicking Send before the Apps Script URL is configured displayed setup guidance and preserved the selected order rather than clearing it.

During the first UI run, the test caught a real issue where modal CSS could override the HTML `hidden` attribute. The stylesheet was corrected with an explicit `[hidden] { display: none !important; }` rule and the complete phone-size flow was retested successfully.

## Live email test still required after deployment

A live email send cannot be completed from this build environment because the Apps Script Web App must be created and authorized inside the owner's Google account. The frontend is wired to the supplied Apps Script backend and will send once its `/exec` deployment URL is pasted into `data/config.json`.

After deployment, perform one final live test:

1. Add a product.
2. Enter store and employee name.
3. Send the request.
4. Confirm it arrives at `lpgasbilling@gmail.com`.
5. Immediately submit the same unchanged request again and verify duplicate protection reports it as already received instead of sending a second email.
