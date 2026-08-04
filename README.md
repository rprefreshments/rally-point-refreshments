# Rally Point Refreshments — Real Order System

This version includes a real order system plus quick customer texting and automatic email:

- Automatic order saving
- Server-calculated prices
- Confirmation numbers
- Private `/admin` order dashboard
- Status tracking
- Text ordering fallback
- Optional email notifications through Resend

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

## Security notes

- Prices are recalculated by the Worker; the browser cannot choose its own total.
- The admin dashboard and order API require the admin password.
- Do not put `ADMIN_PASSWORD` or `RESEND_API_KEY` in GitHub.


## Text and email setup

See `EMAIL_SETUP.md` for the exact Resend and Cloudflare setup steps.


## V6 conversion update

See `V6_UPDATE.md` for installation and testing instructions.
