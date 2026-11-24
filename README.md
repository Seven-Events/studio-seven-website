# Studio Seven website

The Studio Seven flower shop and coffee bar website (downtown Omemee, Ontario).
Customers order coffee ahead, buy flowers, pre-order flowers for a date, and ask about the mobile coffee cart.

- **The menu comes from Square.** Items, prices, photos, milk and add-on choices, and stock are all managed in your Square Item Library, the same list the counter uses.
- **Orders and payments go through Square.** Paid orders show up in Square Point of Sale for staff, just like an in-person order.
- **Coffee cart requests** are saved as customers in Square, and the shop gets an email for each one through Resend.
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
| `shop-settings.json` | Which Square categories show on the website and in what order, plus HST, the shop's address and delivery rate, flower occasions, pre-order window, Christmas pickup days and little tags like "Bestseller". |
| `public/index.html` | The page itself: layout, colours and wording. |
| `public/app.js` | What happens when people tap things: menu, order sheet, checkout, forms. |
| `api/` | Vercel functions. They are thin wrappers around the code in `lib/`. |
| `lib/catalog.js` | Reads the Item Library and stock from Square and turns it into the website menu. |
| `lib/order.js` | Checks every order against the live Square menu. Orders use Square's own items, so Square sets the prices and nobody can change one in their browser. |
| `lib/checkout.js` | Creates the Square order and charges the customer. |
| `lib/signup.js` | Saves coffee cart requests to Square, and emails the shop. |
| `lib/schedule.js` | Closed days, no-delivery days and the delivery rate from `/admin.html`, saved on the shop location in Square. |
| `lib/hours.js` | Opening hours from the shop location in Square, so coffee pickup times are only offered while you're open. |
| `lib/delivery.js` | Works out the delivery cost from the driving distance to the customer's address. |
| `test/` | Automated checks. Run `npm test`. |

The code in `lib/` doesn't depend on Vercel, so a future staff admin (for example a Next.js app with a login) can reuse it directly.

## One-time setup (about an hour)

### 1. Square

1. Make a Square account for Studio Seven at squareup.com, if you don't have one yet, and add the shop as a location.
2. Go to developer.squareup.com, sign in with the same account, and click **Create an application**. Call it "Studio Seven website".
3. On the app's **Credentials** page, open the **Sandbox** tab. Copy the **Application ID** and the **Access token**.
4. On the **Locations** page, Sandbox tab, copy the **Location ID**.
5. *Optional:* in Square Dashboard, go to **Customers > Groups** and create a group called "Coffee cart requests". Copy its ID from its page address.

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
| `SQUARE_CART_GROUP_ID` | *Optional:* "Coffee cart requests" group ID |
| `RESEND_API_KEY` | From Resend |
| `NOTIFY_EMAIL` | Where the shop wants the emails. To send to several people, separate the addresses with commas. |
| `FROM_EMAIL` | *Optional, after verifying your domain:* `Studio Seven <website@yourdomain>` |
| `ORDERS_OPEN` | `true` (set to `false` to pause online ordering) |
| `STAFF_PASSWORD` | A password you choose for the staff pages: shop days at `/admin.html` and photo focus at `/focus.html` |
| `GOOGLE_MAPS_API_KEY` | *Optional:* a Google Maps key with the Routes API turned on, for delivery distances. Without it the site uses free OpenStreetMap services (see "Delivery") |

3. Redeploy so the variables take effect (**Deployments > ... > Redeploy**).

### 4. Staff notifications for orders

- Paid website orders appear in the **Square Point of Sale app > Orders** on the counter iPad, alongside in-person orders. Each one shows the customer's name and phone, the pickup time (or delivery address and date), drink options, and flower notes such as the card message and pre-order date.
- In Square POS, turn on **new order alerts** in the order or notification settings so the iPad chimes. The exact menu name varies by app version.
- *Optional:* add a kitchen ticket printer, or the **Square KDS** app on a second tablet for the bar, so tickets print or appear automatically.
- Staff move each order to **In progress**, then **Ready**, then **Completed**. Check in Square whether the customer gets a "ready" text for your account type, and turn it on in Square Dashboard if it's available.
- Flower pre-orders arrive the moment they're paid. Their date is shown as the scheduled pickup or delivery time, and "PRE-ORDER for YYYY-MM-DD" (or "CHRISTMAS PRE-ORDER for YYYY-MM-DD") appears on each flower line.

### 5. Test, then go live

1. Add a few items in Square's Item Library in the website categories (see "Managing the menu in Square"). The website menu is empty until you do.
2. In sandbox mode, place a coffee order, a flower order, a flower pre-order and a delivery, all with the test card. Check that each one shows up in Square's sandbox dashboard with the right details.
3. Send a coffee cart request. Check that the shop email arrives and the customer appears in Square's sandbox **Customers**.
4. When you're ready, repeat Square steps 3 to 5 on the **Production** tab (production has its own customer groups), update the variables (`SQUARE_ENV=production`), and redeploy.
5. *Optional:* to switch on Apple Pay, register the website's domain under **Apple Pay** in the Square developer dashboard. Google Pay works without this step.
6. Add your own domain (for example studioseven.ca) under Vercel **Settings > Domains**.

## Managing the menu in Square

Everything on the website menu comes from **Square Dashboard > Items** (or **Items** in the Square app). Changes show on the website within about a minute.

**Categories decide where things go.** Put each item in one of these Square categories:

| Square category | Shows on the website under |
| --- | --- |
| Hot drinks, Cold drinks | Coffee, as sections in that order |
| Fresh flowers | Flowers |

Capital letters don't matter, so "hot drinks" in Square works too, but the spelling does. Items in any other category (for example "Merch" or staff-only items) stay in-store only. To rename, add or reorder the coffee tabs, change the lists in `shop-settings.json`, or ask Claude to.

**Items**

- **Name, description and price** are the item's name, description and price in Square.
- **Sizes** are the item's **variations**, such as "8 oz / 12 oz / 16 oz" or "Standard / Generous". Each one has its own price. An item with one variation has no size choice.
- **Product pages:** every flower has its own page (tap it on the website), with its own link like `yoursite.ca/#p/...` that you can share. Coffee drinks still open as a quick pop-up.
- **More than one photo:** add several photos to an item in Square and its product page shows them all, in the same order as Square. Customers can swipe through them on a phone or tap the small photos underneath. The first photo is the main one, used on tiles and on the home page, and it is the one your focus spot applies to.
- **Photos:** add an image to the item in Square. The first image shows on the flower tiles and at the top of the order sheet. Square-shaped or portrait photos look best on the flower tiles. Colour-grade photos before uploading so they match each other; the site shows them as they are.
- **Photo focus:** open `/focus.html` on the website, tap the part of each flower photo that should always stay in view, and press **Save**. It asks for the staff password the first time on each device. The spot is saved on the item in Square (as "Photo focus") and shows for everyone within about a minute. Saving needs `STAFF_PASSWORD` set in Vercel (see the environment variables table).
- **Milk, syrups and add-ons** are **modifier sets** attached to the item. A modifier set that allows one choice shows as buttons, and one that allows several shows as checkboxes. Mark a set **required** to make customers pick, for example milk on a latte. A modifier that's on by default is pre-selected.
- **To hide an item from the website**, move it out of the website categories, archive it, or remove the shop location from it.
- **Order:** items appear in the order you arrange them within the category in Square.

**Stock**

- **Flowers and limited items:** turn on **Track stock** for the variation and enter the quantity for the Omemee location. Website and in-store sales both count it down. When it hits zero, the website shows **Sold out** and won't take more orders.
- **Run out of something for the day,** like oat milk or a flower? Mark the variation **Sold out** for the location in Square. Turn it off again when it's back.

**Taxes:** the website charges HST at the rate in `shop-settings.json` (13%) on every order, separately from your in-store tax settings in Square.

## Everyday changes

- **Closed days, holidays and no-delivery days:** open `/admin.html` on the website (bookmark it on your phone). It asks for the staff password the first time on each device. Pick **Closed** (no orders at all) or **No deliveries** (pickup still open), choose the day or the first and last day of a stretch, add a note customers will see if you like (for example "Christmas"), press **Add**, then **Save**. Under **Weekly schedule**, tap the days the shop is open and, separately, the days you deliver. On a day the shop is closed but deliveries run, customers can order delivery but not pickup or coffee; on a day without deliveries, they can still pick up. Checkout greys those days out, and the server refuses them too. When the shop is closed today, coffee orders and "Soonest" pickup are switched off for the day. Days are saved on your shop location in Square, so there's nothing else to set up.
- **Delivery rate, minimum and distance:** also on `/admin.html`, under **Delivery** (per km, the least a delivery costs, and the furthest km you'll go). Press **Save**.

- **Change the menu, prices, photos or stock:** do it in Square, as above.
- **Set the Christmas pickup and delivery days:** in `shop-settings.json`, under `christmas`, put the days in `dates` as year-month-day, for example `"dates": ["2026-12-20", "2026-12-23"]`, and commit the change (or ask Claude to). `items` lists the Christmas-only items by their exact Square name. While `dates` is empty, those items sell like any other flowers. Once it has days, the items show a "Christmas" tag and customers must pick one of those days at checkout, for pickup or delivery. Each day stops taking orders `orderAheadDays` before it (1 means order by the day before). When every day has passed, the items show "Christmas orders closed". Empty `dates` again after Christmas.
- **Pause online orders** (before opening day, or on a slammed morning): set `ORDERS_OPEN` to `false` in Vercel and redeploy. The menu stays visible, but checkout explains that ordering is paused.

## How orders work

- Coffee is pickup only, either as soon as possible (ready in about 10 minutes) or at a chosen time up to about 4 hours ahead. Times are only offered while the shop is open, using the **business hours on your location in Square** (Square Dashboard > Account & Settings > Business information > Locations), with last coffee orders 15 minutes before closing (`lastCoffeeMins` in `shop-settings.json`). Before opening, customers can pick a time from opening onwards; after closing, checkout says when you're next open. Change your hours in Square and the website follows within about a minute. If Square has no hours set, `hours` in `shop-settings.json` is used, and if that's empty too, times aren't limited by the clock. Closed days from `/admin.html` still apply.
- Flowers can be picked up or delivered. Delivery costs $1.25 per km of one-way driving from the shop (41 King St E, Omemee), with a $10 minimum, up to 35 km; all three can be changed at `/admin.html`. As customers type their address, they get address suggestions (from Photon, a free OpenStreetMap service), and they see the distance and price as soon as they pick one, and the server works it out again at payment, so the browser can't change it. At checkout, customers choose "Soonest" or pick a day 2 to 60 days ahead. One order has one date, because each Square order holds one pickup or delivery.
- Orders with Christmas items must be for one of the Christmas days (see "Everyday changes").
- An order with coffee and flowers is a single pickup today. To have flowers delivered or pre-order them for another day, customers order the flowers separately.
- HST (13%) is added to each order, and Square calculates the total, so the amount charged always matches Square's own calculation.
- An order is refused if an item sold out or was removed in Square since the customer opened the page.

## Delivery

The delivery cost is the one-way driving distance from the shop, rounded to 0.1 km, times the per-km rate. Addresses further than the limit can't choose delivery.

- **Without `GOOGLE_MAPS_API_KEY`** (the default), the site uses free OpenStreetMap services: Nominatim finds the address, and OSRM's public server measures the drive. They need no account, but they're run by volunteers with no guarantee, so on rare occasions a customer may see "We couldn't work out the delivery distance just now" and need to try again or call. Addresses are only accepted when they're found to at least the street, so typing just a town isn't enough.
- **With `GOOGLE_MAPS_API_KEY`**, Google's Routes API measures the drive instead, which is more reliable and better at rural addresses. In Google Cloud, create a project, turn on the **Routes API**, create an API key restricted to that API, add it in Vercel, and redeploy. Google's free monthly allowance covers a small shop's deliveries many times over, but it asks for a billing account.

## For developers

```
npm test       # menu, order, checkout and sign-up tests (Node 20+, no packages needed)
vercel dev     # run locally; copy .env.example to .env.local first
```

No npm dependencies. The server talks to Square's REST API (`lib/square.js`) and Resend's API directly.
Handlers in `lib/` take plain input and return `{ status, body }`. `lib/vercel.js` adapts them to Vercel functions.
