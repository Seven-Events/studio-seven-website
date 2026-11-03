# Studio Seven website

The Studio Seven flower shop and coffee bar website (downtown Omemee, Ontario).
Customers order coffee ahead, buy flowers, pre-order flowers for a date, join the opening list, and ask about the mobile coffee cart.

- **Orders and payments go through Square.** Paid orders show up in Square Point of Sale for staff, just like an in-person order.
- **Opening-list sign-ups and coffee cart requests** are saved as customers in Square, and the shop gets an email for each one through Resend.
- **The site is hosted on Vercel.**

## How it fits together

```
Customer's phone ──> Vercel (website in public/ + small functions in api/)
                        │
                        ├─ /api/checkout ──> Square: create order ──> Square POS (staff get it)
                        │                     └─> Square: take payment (card, Apple Pay, Google Pay)
                        │
                        └─ /api/signup ────> Square: save customer (+ add to a group)
                                              └─> Resend: email the shop
```

| File | What it is |
| --- | --- |
| `public/menu.json` | **The menu.** Names, descriptions and prices (in cents). Edit this to change the menu. |
| `public/index.html` | The page itself: layout, colours and wording. |
| `public/app.js` | What happens when people tap things: menu, order sheet, checkout, forms. |
| `api/` | Vercel functions. They are thin wrappers around the code in `lib/`. |
| `lib/order.js` | Prices every order from `menu.json` on the server, so nobody can change a price in their browser. |
| `lib/checkout.js` | Creates the Square order and charges the customer. |
| `lib/signup.js` | Saves opening-list and coffee cart requests to Square, and emails the shop. |
| `test/` | Automated checks. Run `npm test`. |

The code in `lib/` doesn't depend on Vercel, so a future staff admin (for example a Next.js app with a login) can reuse it directly.

## One-time setup (about an hour)

### 1. Square

1. Make a Square account for Studio Seven at squareup.com, if you don't have one yet, and add the shop as a location.
2. Go to developer.squareup.com, sign in with the same account, and click **Create an application**. Call it "Studio Seven website".
3. On the app's **Credentials** page, open the **Sandbox** tab. Copy the **Application ID** and the **Access token**.
4. On the **Locations** page, Sandbox tab, copy the **Location ID**.
5. *Optional:* in Square Dashboard, go to **Customers > Groups** and create two groups, "Opening list" and "Coffee cart requests". Copy each group's ID from its page address.

Sandbox is Square's test mode. Payments there are fake, so you can try everything safely.
Square's test card is `4111 1111 1111 1111`, with any future expiry date, any CVV and any postal code.

### 2. Email (Resend)

1. Sign up at resend.com, which is free for up to 3,000 emails a month, and create an API key.
2. To send from your own address (for example `website@studioseven.ca`), add and verify your domain in Resend. Until then, emails come from Resend's test address and can only go to the email you signed up with.

### 3. Vercel

1. In Vercel, choose **Add New > Project** and import `Seven-Events/studio-seven-website`. Set the framework preset to **Other** and leave the build settings empty. Vercel serves `public/` and turns `api/` into functions automatically.
2. Under **Settings > Environment Variables**, add:

| Name | Value |
| --- | --- |
| `SQUARE_ENV` | `sandbox` (change to `production` at launch) |
| `SQUARE_APP_ID` | Application ID from Square step 3 |
| `SQUARE_ACCESS_TOKEN` | Access token from Square step 3 (keep this secret, and never put it in the code) |
| `SQUARE_LOCATION_ID` | Location ID from Square step 4 |
| `SQUARE_WAITLIST_GROUP_ID` | *Optional:* "Opening list" group ID |
| `SQUARE_CART_GROUP_ID` | *Optional:* "Coffee cart requests" group ID |
| `RESEND_API_KEY` | From Resend |
| `NOTIFY_EMAIL` | Where the shop wants the emails. To send to several people, separate the addresses with commas. |
| `FROM_EMAIL` | *Optional, after verifying your domain:* `Studio Seven <website@yourdomain>` |
| `ORDERS_OPEN` | `true` (set to `false` to pause online ordering) |

3. Redeploy so the variables take effect (**Deployments > ... > Redeploy**).

### 4. Staff notifications for orders

- Paid website orders appear in the **Square Point of Sale app > Orders** on the counter iPad, alongside in-person orders. Each one shows the customer's name and phone, the pickup time (or delivery address and date), drink options, and flower notes such as the card message and pre-order date.
- In Square POS, turn on **new order alerts** in the order or notification settings so the iPad chimes. The exact menu name varies by app version.
- *Optional:* add a kitchen ticket printer, or the **Square KDS** app on a second tablet for the bar, so tickets print or appear automatically.
- Staff move each order to **In progress**, then **Ready**, then **Completed**. Check in Square whether the customer gets a "ready" text for your account type, and turn it on in Square Dashboard if it's available.
- Flower pre-orders arrive the moment they're paid. Their date is shown as the scheduled pickup or delivery time, and "PRE-ORDER for YYYY-MM-DD" appears on each line.

### 5. Test, then go live

1. In sandbox mode, place a coffee order, a flower order, a flower pre-order and a delivery, all with the test card. Check that each one shows up in Square's sandbox dashboard with the right details.
2. Join the opening list and send a coffee cart request. Check that the shop email arrives and the customer appears in Square's sandbox **Customers**.
3. When you're ready, repeat Square steps 3 to 5 on the **Production** tab (production has its own customer groups), update the variables (`SQUARE_ENV=production`), and redeploy.
4. *Optional:* to switch on Apple Pay, register the website's domain under **Apple Pay** in the Square developer dashboard. Google Pay works without this step.
5. Add your own domain (for example studioseven.ca) under Vercel **Settings > Domains**.

## Everyday changes

- **Change the menu or prices:** edit `public/menu.json` and save it to GitHub. Vercel redeploys within a minute. Prices are in cents, so `525` means $5.25.
- **Pause online orders** (before opening day, or on a slammed morning): set `ORDERS_OPEN` to `false` in Vercel and redeploy. The menu stays visible, but checkout explains that ordering is paused.
- **See the opening list:** in Square Dashboard, open **Customers**, filter by the "Opening list" group, and export it when you're ready to email everyone.

## How orders work

- Coffee is pickup only, either as soon as possible (ready in about 10 minutes) or at a chosen time up to about 3.5 hours ahead.
- Flowers can be picked up or delivered (a $12 fee, Omemee, Lindsay and nearby) and pre-ordered 2 to 60 days ahead.
- An order with coffee and flowers is a single pickup. For flower delivery, customers order flowers separately, because each Square order holds one pickup or delivery.
- HST (13%) is added by Square, so the total the customer pays always matches Square's own calculation.

## For developers

```
npm test       # pricing, checkout and sign-up tests (Node 20+, no packages needed)
vercel dev     # run locally; copy .env.example to .env.local first
```

No npm dependencies. The server talks to Square's REST API (`lib/square.js`) and Resend's API directly.
Handlers in `lib/` take plain input and return `{ status, body }`. `lib/vercel.js` adapts them to Vercel functions.
