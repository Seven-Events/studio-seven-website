# Studio Seven website

The Studio Seven flower shop and coffee bar website (downtown Omemee, Ontario).
Customers order coffee ahead, buy flowers, pre-order flowers for a date, join the opening list, and ask about the mobile coffee cart.

- **Orders and payments go through Square.** Paid orders show up in Square Point of Sale for staff, just like an in-person order.
- **The opening list and coffee cart requests go through Netlify Forms**, which emails them to you.
- **The site is hosted on Netlify.** The free plan covers a shop this size.

## How it fits together

```
Customer's phone ──> Netlify (website + two small server functions)
                        │
                        ├─ /api/checkout ──> Square: create order ──> Square POS (staff get it)
                        │                     └─> Square: take payment (card, Apple Pay, Google Pay)
                        │
                        └─ Netlify Forms ──> email to you (opening list, cart bookings)
```

| File | What it is |
| --- | --- |
| `public/menu.json` | **The menu.** Names, descriptions and prices (in cents). Edit this to change the menu. |
| `public/index.html` | The page itself: layout, colours and wording. |
| `public/app.js` | What happens when people tap things: menu, order sheet, checkout, forms. |
| `netlify/functions/checkout.js` | Server code that creates the Square order and charges the customer. |
| `lib/order.js` | Prices every order from `menu.json` on the server, so nobody can change a price in their browser. |
| `test/` | Automated checks. Run `npm test`. |

## One-time setup (about an hour)

### 1. Square

1. Make a Square account for Studio Seven at squareup.com, if you don't have one yet, and add the shop as a location.
2. Go to developer.squareup.com, sign in with the same account, and click **Create an application**. Call it "Studio Seven website".
3. On the app's **Credentials** page, open the **Sandbox** tab. Copy the **Application ID** and the **Access token**.
4. On the **Locations** page, Sandbox tab, copy the **Location ID**.

Sandbox is Square's test mode. Payments there are fake, so you can try everything safely.
Square's test card is `4111 1111 1111 1111`, with any future expiry date, any CVV and any postal code.

### 2. GitHub and Netlify

1. Put this folder in a GitHub repository. (Claude can push it once the repository exists.)
2. Sign up at netlify.com with GitHub. Choose **Add new site > Import an existing project**, then pick the repository. Leave the build settings as they are, since `netlify.toml` has them.
3. In Netlify, open **Site configuration > Environment variables** and add:

| Name | Value |
| --- | --- |
| `SQUARE_ENV` | `sandbox` (change to `production` at launch) |
| `SQUARE_APP_ID` | Application ID from step 1 |
| `SQUARE_ACCESS_TOKEN` | Access token from step 1 (keep this secret, and never put it in the code) |
| `SQUARE_LOCATION_ID` | Location ID from step 1 |
| `ORDERS_OPEN` | `true` (set to `false` to pause online ordering) |

4. Redeploy the site after adding the variables (**Deploys > Trigger deploy**).

### 3. Staff notifications

**Website orders (Square):**
- Paid website orders appear in the **Square Point of Sale app > Orders** on the counter iPad, alongside in-person orders. Each one shows the customer's name and phone, the pickup time (or delivery address and date), drink options, and flower notes such as the card message and pre-order date.
- In Square POS, open **Settings > Notifications** (or **Orders settings**, depending on your version) and turn on **new order alerts** so the iPad chimes.
- *Optional:* add a kitchen ticket printer, or the **Square KDS** app on a second tablet for the bar, so tickets print or appear automatically.
- Staff move each order to **In progress**, then **Ready**, then **Completed**. Check in Square whether the customer gets a "ready" text for your account type, and turn it on in Square Dashboard if it's available.
- Flower pre-orders arrive the moment they're paid. Their date is shown as the scheduled pickup or delivery time, and "PRE-ORDER for YYYY-MM-DD" appears on each line.

**Opening list and coffee cart requests (Netlify):**
- In Netlify, open **Forms > Form notifications > Add notification > Email notification**. Add one for `waitlist` and one for `cart-booking`, sent to the shop email.
- Every sign-up is also listed under **Forms** in Netlify, where you can download it as a CSV to import into a mailing tool later.

### 4. Test, then go live

1. In sandbox mode, place a coffee order, a flower order, a flower pre-order and a delivery, all with the test card. Check that each one shows up in Square's sandbox dashboard with the right details.
2. When you're ready, repeat Square steps 3 and 4 on the **Production** tab, update the four Netlify variables (`SQUARE_ENV=production`), and redeploy.
3. *Optional:* to switch on Apple Pay, register the website's domain under **Apple Pay** in the Square developer dashboard. Google Pay works without this step.
4. Connect your own domain (for example studioseven.ca) under Netlify **Domain management**.

## Everyday changes

- **Change the menu or prices:** edit `public/menu.json` and save it to GitHub. Netlify redeploys within a minute. Prices are in cents, so `525` means $5.25.
- **Pause online orders** (before opening day, or on a slammed morning): set `ORDERS_OPEN` to `false` in Netlify and redeploy. The menu stays visible, but checkout explains that ordering is paused.

## How orders work

- Coffee is pickup only, either as soon as possible (ready in about 10 minutes) or at a chosen time up to about 3.5 hours ahead.
- Flowers can be picked up or delivered (a $12 fee, Omemee, Lindsay and nearby) and pre-ordered 2 to 60 days ahead.
- An order with coffee and flowers is a single pickup. For flower delivery, customers order flowers separately, because each Square order holds one pickup or delivery.
- HST (13%) is added by Square, so the total the customer pays always matches Square's own calculation.

## For developers

```
npm test           # pricing and checkout tests (Node 20+, no packages needed)
npx netlify dev    # run locally; copy .env.example to .env first
```

No npm dependencies. The server talks to Square's REST API directly (`lib/square.js`).
