# Store Order Reference

A mobile-first employee product reference and internal order-request website for the supplied Sam's Club and Walmart catalogs.

## Recommended architecture

**Frontend:** static HTML/CSS/JavaScript hosted on GitHub Pages.  
**Email backend:** Google Apps Script Web App using `MailApp`, with the recipient fixed server-side as `lpgasbilling@gmail.com`.

This keeps the site lightweight and free while avoiding email passwords, API keys, private keys, or other secrets in the browser. The frontend is a static PWA, so GitHub Pages is a natural fit; Apps Script handles the one server-side job GitHub Pages cannot do: send the email.

### Why this option

| Option | Ongoing cost | Setup | Maintenance | Email reliability | Main tradeoff |
| --- | --- | --- | --- | --- | --- |
| GitHub Pages + form service | Often free only at low volume | Easiest | Very low | Good | Free tiers have submission limits and add vendor dependence |
| **GitHub Pages + Google Apps Script** | **$0 for normal store use** | **Simple** | **Low** | **Good via Gmail/MailApp** | Apps Script has daily email quotas |
| GitHub Pages + serverless function + email API | Usually $0 at small volume | More involved | Medium | Very good | Extra provider, API key, and often domain verification |
| Apps Script for both frontend + backend | $0 | Simple | Low | Good | Less convenient static/PWA deployment and weaker frontend workflow |

For this internal app, Apps Script is the best balance of cost, simplicity, security, and maintainability.

## What is included

- 135 products total: 95 Sam's Club + 40 Walmart.
- Product photos extracted from the supplied reference PDFs where a photo was present.
- Four products correctly use a "No photo supplied" placeholder because the source reference did not contain an image for them.
- Search by name, brand, item number, category, pack size, or variety.
- Retailer filters and category jump controls.
- Mobile product cards with Add, quantity controls, and per-product notes.
- Slide-up order review with required store and employee name.
- General order notes.
- Browser persistence so an accidental refresh does not lose the order.
- Duplicate prevention on both the interface and server side.
- Basic abuse protection: honeypot, timing validation, field limits, per-device rate limiting, and duplicate hashing.
- Installable PWA shell and on-demand image caching.
- Email grouped by retailer and category.
- No credentials or secret keys in frontend code.

## Project structure

```text
employee-ordering-site/
├── index.html
├── manifest.webmanifest
├── sw.js
├── .nojekyll
├── assets/
│   ├── app.js
│   ├── styles.css
│   ├── icons/
│   └── products/
│       ├── sams/
│       └── walmart/
├── data/
│   ├── config.json
│   └── products.json
├── backend/
│   ├── Code.gs
│   └── appsscript.json
└── tools/
    └── validate_catalog.py
```

## 1. Configure your store list

Edit `data/config.json`.

```json
"stores": [
  { "id": "south-60", "name": "South 60 Market" },
  { "id": "state-street", "name": "State Street Market" },
  { "id": "nashport-exxon", "name": "Nashport Exxon CPB" },
  { "id": "other", "name": "Other / Not listed", "allowCustom": true }
]
```

You can add, remove, rename, or reorder stores here without changing the interface code.

## 2. Deploy the Google Apps Script email backend

1. Sign in to the Google account that should send the order emails.
2. Go to **script.google.com** and create a new project.
3. Replace the default `Code.gs` contents with `backend/Code.gs` from this project.
4. In Apps Script, open **Project Settings** and confirm the time zone is appropriate. The included script uses `America/New_York`.
5. Click **Deploy → New deployment**.
6. Select **Web app**.
7. Set **Execute as** to **Me**.
8. Set **Who has access** to **Anyone**.
9. Deploy and authorize the script when Google prompts you.
10. Copy the Web App URL. It should end in `/exec`.

The destination email address is fixed in `backend/Code.gs`:

```javascript
const RECIPIENT = 'lpgasbilling@gmail.com';
```

This is intentionally server-side. The website never receives a Gmail password, OAuth token, API secret, or private key.

### Important when updating the backend

Apps Script web apps use deployments. After changing `Code.gs`, create a new version/update the deployment so the live `/exec` URL uses the new code.

## 3. Connect the frontend to Apps Script

Open `data/config.json` and replace:

```json
"appsScriptUrl": "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"
```

with the `/exec` URL from the Apps Script deployment.

Example format:

```json
"appsScriptUrl": "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec"
```

Do not put any password, Gmail credential, private key, or email API secret in `config.json`.

## 4. Test locally before publishing

Do not double-click `index.html` because browsers restrict `fetch()` from `file://` pages. Serve the folder locally instead:

```bash
cd employee-ordering-site
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Recommended test flow:

1. Search for `Monster`.
2. Add two products.
3. Increase one quantity.
4. Add a product note.
5. Refresh the page and verify selections remain.
6. Open **Review order**.
7. Select a store and enter an employee name.
8. Send the order.
9. Confirm only one email arrives.
10. Immediately resend the same request and confirm the backend reports it as a duplicate instead of emailing it again.

## 5. Publish with GitHub Pages

1. Create a GitHub repository.
2. Upload the contents of `employee-ordering-site` to the repository root.
3. Commit and push.
4. In the repository, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select your main branch and `/ (root)`.
7. Save.
8. After deployment, open the GitHub Pages URL and run the full employee test once more.

The `.nojekyll` file is included so GitHub Pages serves the project as plain static files.

## Product catalog maintenance

All catalog data is in `data/products.json`. The interface does not need to be redesigned when products change.

Each product supports:

```json
{
  "id": "sams-001",
  "retailer": "Sam's Club",
  "retailerKey": "sams",
  "category": "Water",
  "sourceCategory": "Water",
  "subcategory": "Everyday water",
  "brand": "Member's Mark",
  "productName": "Member's Mark Purified Water",
  "variety": "",
  "packCount": "40Pk",
  "individualSize": "16.9 fl. oz.",
  "productNumber": "",
  "price": 4.28,
  "priceDisplay": "$4.28",
  "priceAsOf": "2026-09-21",
  "priceNote": "",
  "sourceNote": "",
  "availability": "",
  "image": "assets/products/sams/example.webp",
  "active": true,
  "displayOrder": 1
}
```

### Adding a product

1. Add the product image under `assets/products/sams/` or `assets/products/walmart/`.
2. Add a product object to `data/products.json`.
3. Give it a unique `id`.
4. Set `active` to `true`.
5. Use an existing category or add a new category to the top-level `categories` array.

### Temporarily hiding a product

Set:

```json
"active": false
```

The product remains in the data file but disappears from the employee catalog.

### Price updates

Update `price`, `priceDisplay`, and `priceAsOf`. Prices are deliberately shown as reference prices with a notice that they may change.

## Spam, abuse, and duplicate protection

The Apps Script backend includes lightweight protection suitable for a small internal employee app:

- Fixed email recipient.
- Hidden honeypot field.
- Minimum/maximum submission timing checks.
- Strict field length and quantity limits.
- Retailer validation.
- Per-browser client rate limiting.
- SHA-256 duplicate-order hash cached for 10 minutes.
- Email content escaped before HTML rendering.

This is intentionally simple. If the public URL ever receives meaningful automated abuse, the next upgrade should be Cloudflare Turnstile or restricting access through an authenticated employee portal.

## Gmail / Apps Script limits

Apps Script consumer Gmail accounts have daily email recipient limits. Because each order request sends to one recipient, normal internal store usage should stay well below the limit. If the operation later grows beyond those quotas, migrate only the backend to a serverless email API; the frontend and product JSON can remain unchanged.

## PWA / home-screen use

When hosted over HTTPS, the app registers `sw.js` and can be installed to a phone's home screen. The app shell and catalog data are cached; viewed product images are cached as employees browse. A live internet connection is still required to email an order request.

## Source notes

The product catalog was built from the supplied Sam's Club and Walmart reference PDFs. Prices are the supplied reference prices recorded September 21, 2026, not live retailer pricing.
