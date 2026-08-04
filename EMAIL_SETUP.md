# Text Us + Automatic Email Setup

## What this update adds

- A visible **Text us** button in the website header
- A second text button in the business section
- Automatic new-order email to `rprefreshment@gmail.com`
- Automatic confirmation email to customers who provide an email
- Better branded HTML email layouts
- Customer email replies go to the business Gmail
- Business notification replies go to the customer when they supplied an email

## Upload the code

Use GitHub Desktop:

1. Unzip this package.
2. Copy everything inside it into your cloned `rally-point-refreshments` repository.
3. Replace matching files.
4. In GitHub Desktop, commit with:

   `Add text contact and automatic emails`

5. Push origin.
6. Wait for Cloudflare to deploy.

## Turn on automatic email with Resend

1. Create a free account at Resend.
2. In Resend, open **Domains** and add:

   `rallypointrefreshments.com`

3. Use Resend's **Sign in to Cloudflare** automatic DNS setup.
4. Wait until the domain status says **Verified**.
5. In Resend, open **API Keys**.
6. Create a key named:

   `Rally Point Production`

7. Choose **Sending access** and restrict it to your verified domain.
8. Copy the API key immediately. It is only displayed once.

## Add the API key to Cloudflare

1. Open Cloudflare.
2. Go to **Workers & Pages → rally-point-refreshments → Settings**.
3. Under the runtime **Variables and secrets** section, click **Add**.
4. Choose **Secret**.
5. Enter:

   - Name: `RESEND_API_KEY`
   - Value: paste the API key beginning with `re_`

6. Save and deploy.

Do not add this key under the Build section and never put it in GitHub.

The existing runtime variables should remain:

- `ORDER_EMAIL` = `rprefreshment@gmail.com`
- `EMAIL_FROM` = `Rally Point Orders <orders@rallypointrefreshments.com>`

## Test

1. Place a test order using a different email address.
2. Confirm the order appears in `/admin`.
3. Confirm the business Gmail receives a new-order alert.
4. Confirm the customer email receives an order confirmation.
5. Check Spam/Promotions if either message does not appear immediately.

Orders are still safely stored even if an email delivery fails.
