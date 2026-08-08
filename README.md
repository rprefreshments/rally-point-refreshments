# Rally Point Refreshments — Real Order System

This version includes a real order system plus quick customer texting and automatic email:

- Automatic order saving
- Server-calculated prices
- Confirmation numbers
- Private `/admin` order dashboard
- Status tracking
- Text ordering fallback
- Optional email notifications through Resend
- Required online card checkout through Square
- Embedded secure card-entry page at `/pay`
- Square payment status and receipt links in the private dashboard

## Deploy

1. Extract this ZIP.
2. Copy `src/worker.js` into your repository's `src/` folder.
3. Copy everything inside `public/` into your repository's `public/` folder (this includes `index.html`, `style.css`, `app.js`, `admin.html`, `admin.css`, `admin.js`, `manifest.json`, `service-worker.js`, and the `images/` folder).
4. Do **not** place these files at the repository root — `wrangler.jsonc` expects `main: "src/worker.js"` and `assets.directory: "./public"`. Placing files at the root will make `npx wrangler deploy` fail.
5. Keep the Cloudflare deploy command as:

   `npx wrangler deploy`

6. Commit the changes. Cloudflare will deploy automatically.

The Wrangler configuration requests a D1 binding named `DB`. Modern Wrangler deployments can automatically provision the D1 database when the project deploys. The Worker creates its own orders table on the first API request.

## Set the private dashboard password

After deployment:

1. Open Cloudflare.
2. Go to **Workers & Pages → rally-point-refreshments → Settings**.
3. Find **Variables and Secrets** or **Bindings**.
4. Add an encrypted secret:

   - Name: `ADMIN_PASSWORD`
   - Value: choose a strong password that is not used anywhere else.

5. Open:

   `https://rallypointrefreshments.com/admin`

6. The browser will ask for:

   - Username: `admin`
   - Password: the secret you created.

## Test before sharing

1. Place a small test order on the live website.
2. Confirm that the customer sees an order number.
3. Open `/admin`.
4. Confirm that the order appears.
5. Change its status and refresh.

## Optional email notifications

Orders are saved and visible in `/admin` without any email service.

For instant email alerts and optional customer receipts:

1. Create a Resend account.
2. Verify a sending domain or subdomain.
3. In the Cloudflare Worker, add the encrypted secret:

   - `RESEND_API_KEY`

4. Ensure these variables are correct:

   - `ORDER_EMAIL=rprefreshment@gmail.com`
   - `EMAIL_FROM=Rally Point Orders <orders@rallypointrefreshments.com>`

The code automatically sends the business a new-order email when the secret is configured.

## Square online card checkout

Normal website checkout now requires online card payment. After the customer enters their order details, the site opens Rally Point's own `/pay` page. Square's Web Payments SDK renders the secure card fields, creates a one-time payment token, and the Worker charges the exact server-calculated order total through Square's Payments API.

The payment uses the Square business location selected by `SQUARE_LOCATION_ID`, so completed website transactions appear in the same Square account used for the business. Rally Point's site never receives or stores raw card numbers.

### Test safely in Square Sandbox first

1. Go to [developer.squareup.com/apps](https://developer.squareup.com/apps), sign in with the Square business account, and create or open the **Rally Point Website** application.
2. Switch the Developer Console to **Sandbox** and copy all three matching Sandbox values:
   - Application ID
   - Access Token
   - Location ID
3. In Cloudflare, open **Workers & Pages → rally-point-refreshments → Settings → Variables and Secrets**.
4. Add these values:
   - `SQUARE_APPLICATION_ID` — Sandbox Application ID (plain variable is acceptable)
   - `SQUARE_ACCESS_TOKEN` — Sandbox Access Token (**encrypted secret**)
   - `SQUARE_LOCATION_ID` — Sandbox Location ID
   - `SQUARE_ENVIRONMENT` — `sandbox`
5. Redeploy and place a test order. Use Square's Sandbox card `4111 1111 1111 1111`, CVV `111`, any future expiration date, and ZIP `27536`.
6. Confirm the payment succeeds, the order dashboard says **Paid online**, and its Square receipt opens.

### Switch to live payments

1. In the same Square application, switch the Developer Console to **Production**.
2. Replace all three Square values in Cloudflare with the matching Production Application ID, Production Access Token, and Production Location ID.
3. Set `SQUARE_ENVIRONMENT` to `production` or remove it.
4. Redeploy, then make one small real purchase and refund it from Square if desired.

Do not mix Sandbox and Production credentials. Checkout intentionally stops before creating an order when the Square configuration is incomplete.

## Security notes

- Prices are recalculated by the Worker; the browser cannot choose its own total.
- The admin dashboard and order API require the admin password.
- Do not put `ADMIN_PASSWORD`, `RESEND_API_KEY`, `SQUARE_ACCESS_TOKEN`, or `.dev.vars` in GitHub.
- Payment access links use a random secret in the URL fragment; only a SHA-256 hash is stored in D1.
- The payment page sends a strict Content Security Policy required by Square's Web Payments SDK.


## Text and email setup

See `EMAIL_SETUP.md` for the exact Resend and Cloudflare setup steps.


## V6 conversion update

See `V6_UPDATE.md` for installation and testing instructions.
