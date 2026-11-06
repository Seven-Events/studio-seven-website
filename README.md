# Studio Seven website

The Studio Seven flower shop and coffee bar website (downtown Omemee, Ontario).
Customers order coffee ahead, buy flowers, pre-order flowers for a date, sign up for the newsletter, and ask about the mobile coffee cart.

- **The menu comes from Square.** Items, prices, photos, milk and add-on choices, and stock are all managed in your Square Item Library, the same list the counter uses.
- **Orders and payments go through Square.** Paid orders show up in Square Point of Sale for staff, just like an in-person order.
- **Newsletter sign-ups and coffee cart requests** are saved as customers in Square, and the shop gets an email for each one through Resend.
- **The site is hosted on Vercel.**

## How it fits together

```
Customer's phone ──> Vercel (website in public/ + small functions in api/)
                        │
                        ├─ /api/menu ──────> Square: Item Library + stock (cached for 1 minute)
                        │
                        ├─ /api/checkout ──> Square: create order ──> Square POS (staff get it)
                        │                     └─> Square: take payment (card, Apple Pay, Google Pay)
                        │
                        └─ /api/signup ────> Square: save customer (+ add to a group)
                                              └─> Resend: email the shop
```

| File | What it is |
| --- | --- |
| `shop-settings.json` | Which Square categories show on the website and in what order, plus HST, the delivery fee, flower occasions, pre-order window and little tags like "Bestseller". |
| `public/index.html` | The page itself: layout, colours and wording. |
| `public/app.js` | What happens when people tap things: menu, order sheet, checkout, forms. |
| `api/` | Vercel functions. They are thin wrappers around the code in `lib/`. |
| `lib/catalog.js` | Reads the Item Library and stock from Square and turns it into the website menu. |
| `lib/order.js` | Checks every order against the live Square menu. Orders use Square's own items, so Square sets the prices and nobody can change one in their browser. |
| `lib/checkout.js` | Creates the Square order and charges the customer. |
| `lib/signup.js` | Saves newsletter sign-ups and coffee cart requests to Square, and emails the shop. |
| `test/` | Automated checks. Run `npm test`. |

The code in `lib/` doesn't depend on Vercel, so a future staff admin (for example a Next.js app with a login) can reuse it directly.

## One-time setup (about an hour)

### 1. Square

1. Make a Square account for Studio Seven at squareup.com, if you don't have one yet, and add the shop as a location.
2. Go to developer.squareup.com, sign in with the same account, and click **Create an application**. Call it "Studio Seven website".
3. On the app's **Credentials** page, open the **Sandbox** tab. Copy the **Application ID** and the **Access token**.
4. On the **Locations** page, Sandbox tab, copy the **Location ID**.
5. *Optional:* in Square Dashboard, go to **Customers > Groups** and create two groups, "Newsletter" and "Coffee cart requests". Copy each group's ID from its page address.

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
| `SQUARE_WAITLIST_GROUP_ID` | *Optional:* "Newsletter" group ID |
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

1. Add a few items in Square's Item Library in the website categories (see "Managing the menu in Square"). The website menu is empty until you do.
2. In sandbox mode, place a coffee order, a flower order, a flower pre-order and a delivery, all with the test card. Check that each one shows up in Square's sandbox dashboard with the right details.
3. Sign up for the newsletter and send a coffee cart request. Check that the shop email arrives and the customer appears in Square's sandbox **Customers**.
4. When you're ready, repeat Square steps 3 to 5 on the **Production** tab (production has its own customer groups), update the variables (`SQUARE_ENV=production`), and redeploy.
5. *Optional:* to switch on Apple Pay, register the website's domain under **Apple Pay** in the Square developer dashboard. Google Pay works without this step.
6. Add your own domain (for example studioseven.ca) under Vercel **Settings > Domains**.

## Managing the menu in Square

Everything on the website menu comes from **Square Dashboard > Items** (or **Items** in the Square app). Changes show on the website within about a minute.

**Categories decide where things go.** Put each item in one of these Square categories:

| Square category | Shows on the website under |
| --- | --- |
| Espresso, House drinks, No coffee | Coffee, as tabs in that order |
| Flowers | Flowers |

Items in any other category (for example "Merch" or staff-only items) stay in-store only. To rename, add or reorder the coffee tabs, change the lists in `shop-settings.json`, or ask Claude to.

**Items**

- **Name, description and price** are the item's name, description and price in Square.
- **Sizes** are the item's **variations**, such as "8 oz / 12 oz / 16 oz" or "Standard / Generous". Each one has its own price. An item with one variation has no size choice.
- **Photos:** add an image to the item in Square. The first image shows on the flower tiles and at the top of the order sheet. Square-shaped or portrait photos look best on the flower tiles.
- **Milk, syrups and add-ons** are **modifier sets** attached to the item. A modifier set that allows one choice shows as buttons, and one that allows several shows as checkboxes. Mark a set **required** to make customers pick, for example milk on a latte. A modifier that's on by default is pre-selected.
- **To hide an item from the website**, move it out of the website categories, archive it, or remove the shop location from it.
- **Order:** items appear in the order you arrange them within the category in Square.

**Stock**

- **Flowers and limited items:** turn on **Track stock** for the variation and enter the quantity for the Omemee location. Website and in-store sales both count it down. When it hits zero, the website shows **Sold out** and won't take more orders.
- **Run out of something for the day,** like oat milk or a flower? Mark the variation **Sold out** for the location in Square. Turn it off again when it's back.

**Taxes:** the website charges HST at the rate in `shop-settings.json` (13%) on every order, separately from your in-store tax settings in Square.

## Everyday changes

- **Change the menu, prices, photos or stock:** do it in Square, as above.
- **Pause online orders** (before opening day, or on a slammed morning): set `ORDERS_OPEN` to `false` in Vercel and redeploy. The menu stays visible, but checkout explains that ordering is paused.
- **Email the newsletter:** in Square Dashboard, open **Customers** and filter by the "Newsletter" group. Send from **Square Marketing**, or export the list to your email tool. Each sign-up's interests are in the customer note.

## How orders work

- Coffee is pickup only, either as soon as possible (ready in about 10 minutes) or at a chosen time up to about 3.5 hours ahead.
- Flowers can be picked up or delivered (a $12 fee, Omemee, Lindsay and nearby) and pre-ordered 2 to 60 days ahead.
- An order with coffee and flowers is a single pickup. For flower delivery, customers order flowers separately, because each Square order holds one pickup or delivery.
- HST (13%) is added to each order, and Square calculates the total, so the amount charged always matches Square's own calculation.
- An order is refused if an item sold out or was removed in Square since the customer opened the page.

## For developers

```
npm test       # menu, order, checkout and sign-up tests (Node 20+, no packages needed)
vercel dev     # run locally; copy .env.example to .env.local first
```

No npm dependencies. The server talks to Square's REST API (`lib/square.js`) and Resend's API directly.
Handlers in `lib/` take plain input and return `{ status, body }`. `lib/vercel.js` adapts them to Vercel functions.
