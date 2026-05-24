/**
 * lib/prompt-builder/getmobil-website.ts
 *
 * Platform knowhow for the Getmobil website surface.
 * This is not a step-by-step guide — it is background knowledge the QA agent
 * uses to understand the platform before deciding how to act autonomously.
 *
 * All content is sourced deterministically from the getmobil-e2e-test-prompt-library
 * GitHub repository (TC files, fixture files, docs). Nothing is fabricated.
 */

export function buildGetmobilWebsiteContext(): string {
  return `<getmobil_website_context>

<testing_scope>
Always open a new browser tab to run tests. Never run tests on the currently active tab or any localhost page. All testing must happen on https://preprod.getmobil.com opened in a fresh tab.
</testing_scope>

<platform>
Getmobil is a Turkish e-commerce platform for buying, selling, and trading in refurbished and second-hand smartphones.
All UI text is in Turkish.
Test environment: https://preprod.getmobil.com
</platform>

<site_structure>
The site is divided into several distinct areas, each reachable through visible UI elements:

Product catalog: Browse smartphones by category from the main navigation. Individual product pages show price, condition grade, stock status, and an optional trade-in badge. Each product has an "Hızlı Al" (quick buy) button that initiates the purchase flow and, if the user is not logged in, triggers the login modal.

Product selection flexibility: If a specific product cannot be added to the cart (out of stock, unavailable, or not found), the agent must not stop. It should browse other available devices in the product listing, find one that is in stock, and add that to the cart instead. It may also try a different variant of the same product (e.g. different storage capacity or condition grade). The goal is to complete the intended flow, not to insist on an exact product match.

Cart: Accessible from the cart icon in the header. The cart shows selected products and a checkout button. For logged-in users, any previously added items persist. Initiating checkout from the cart is one of the trigger points for the login modal.

User profile and account area: Visible after login. Contains:
  - Siparişlerim (My Orders): full list of placed orders with status labels and a detail view for each
  - Sattıklarım (My Sold Devices): buyback lead history with status tracking per lead
  - Address management and account settings

Buyback section ("Telefon Sat"): A dedicated multi-step form reachable from the "Telefon Sat" link in the main navigation bar. This flow is separate from the product purchase flow.

Footer and navigation: Standard persistent navigation bar at the top of all pages. The profile/account area in the header is present but the icon within it cannot be reliably detected by automation tooling.
</site_structure>

<authentication>
Customer authentication is entirely OTP-based. There is no email/password login for customers on the website surface.

How the system works:
- The login/register modal is NOT accessible by clicking the profile icon in the header directly — it must be triggered by a specific UI action within a flow (e.g. initiating checkout, clicking "Hızlı Al" on a product, or entering the buyback form while unauthenticated)
- When the modal appears, the user enters their phone number
- If the phone number is already registered: an OTP verification screen appears with the message "tekrar hoşgeldiniz"
- If the phone number is new: a registration form appears ("Getmobil'e Ücretsiz Kaydol") collecting name, surname, and e-mail, followed by OTP verification
- After successful OTP entry, the session token is written to localStorage under the key getmobil_access_token
- The buyback flow also offers a guest continuation path that does not require registration or login

Known UI constraint: The profile/user SVG icon in the site header is not detectable by automation tooling. The login modal can only be reached via action-triggered entry points in the user journey.

Exact UI text values:
- Login/register modal title: "Getmobil'e Hoşgeldiniz!"
- Registration form title: "Getmobil'e Ücretsiz Kaydol"
- OTP confirmation step title for new users: "Son Adım"
- Successful login toast: "Başarılı Bir Şekilde Giriş Yaptınız"
</authentication>

<ui_patterns>
Modals: The primary modal for auth is titled "Getmobil'e Hoşgeldiniz!" and serves as the entry point for both login and registration. Modals appear over the page and have a close/dismiss control. The platform uses modals for confirmations, OTP entry, and informational prompts.

Toasts: Action results are communicated via toast notifications in the top-right corner of the screen. Toasts are ephemeral; verify their content immediately after the triggering action.
- Successful login: "Başarılı Bir Şekilde Giriş Yaptınız"
- Other success actions follow a similar toast pattern

Drawers: Used in the trade-in flow. A drawer slides in from the side and contains the device selection form for trade-in offer calculation. The offer displayed in the drawer is fetched asynchronously and may take a moment to appear after opening.

Blocking prompts and informational modals:
- "Getpuana aktarmak için üye olmalısın" — appears when a guest user attempts to select Getpuan as their buyback payment method; requires account creation to proceed
- "Son Adım" — OTP entry popup during new user registration

Loading and async states: Some UI elements and data points (trade-in badge value, buyback offer) are loaded asynchronously after the page renders. These may initially appear as loading indicators or empty before the value becomes visible. Account for async rendering before asserting content presence.

Form patterns: Multi-step forms (buyback, checkout) advance to the next step upon completing the current step's required fields and confirming. Validation errors appear inline below the relevant field.
</ui_patterns>

<payment>
Payment infrastructure: Craftgate.
On preprod, Craftgate is permanently in test mode — no real transactions are processed.
3D Secure screens may appear during the checkout flow and require an OTP input to proceed.
</payment>

<order_lifecycle>
Orders on the Getmobil website surface progress through statuses. The status label is visible on the order list and order detail pages within the profile area.

Key status relevant to test coverage:
- DELIVERED: The order has been received by the customer. This is the only status in which the "Garanti Talebi Oluştur" (Create Warranty Request) button is active. For all other statuses, the button is absent or disabled.

The order detail page (accessible from Siparişlerim) shows the current status, order contents, delivery information, and available actions based on status.
</order_lifecycle>

<domain_concepts>
Buyback ("Telefon Sat" — sell your phone):
- The user sells their own device to Getmobil through a multi-step form in the dedicated buyback section.
- The flow involves selecting device brand, model, storage, and answering a condition assessment questionnaire. The platform then calculates and presents an offer.
- Payment method for the offer: IBAN (bank transfer) or Getpuan (platform credit).
- If Getpuan is selected, the displayed offer amount is increased by 20% (pre_offer × 1.20).
- Guest users cannot select Getpuan; an active account is required to receive Getpuan.
- Delivery options for handing over the device:
  - Courier pickup: available only within İstanbul province, and only when the offer amount is ≥ 2,000 TL
  - Cargo drop-off: available in all provinces; no date or time slot selection is required
- Apple devices: after a successful buyback submission, the platform initiates a Web Diagnostics flow before the process finalises.
- A successfully created buyback lead enters the status: WAITING_CONFIRMATION.
- The lead can be reviewed later in the "Sattıklarım" section of the user profile.

Trade-in (exchange value towards a purchase):
- The user offsets part of the cost of a new product by trading in their old device.
- Entry point: an asynchronous badge displayed on the product detail page. The badge value is fetched after page load and may take a moment to appear.
- Clicking the badge opens a side drawer containing a device selection form.
- After a device is selected, the platform calculates and presents a trade-in offer.
- Accepting the offer ties it to the current cart; the offer has an expiry and remains locked for a limited time.

Warranty ("Garanti" — warranty request):
- Users can submit a warranty request for a product they have purchased.
- The "Garanti Talebi Oluştur" button appears exclusively on orders with status DELIVERED in the Siparişlerim section.
- The user fills in a description of the issue and submits the request.
- After submission, the request is visible to backoffice staff in the "Gelen Kargo" list.

Getpuan (platform credit):
- An internal credit system used as an alternative to IBAN in the buyback payment step.
- Carries a 20% bonus over the cash offer value.
- Cannot be used by guests — requires a registered and logged-in account.
</domain_concepts>

<test_environment>
Static OTP for all OTP-required flows on preprod: 65099
Kafka event processing delay: approximately 500ms — some status changes or event-driven UI updates may take up to this long to reflect after a triggering action.
Craftgate test mode: permanently active on preprod; test card transactions succeed without real charges.
Staging database reset: every Monday at 00:00 UTC; seed data including test users and test products is automatically reloaded.
</test_environment>

</getmobil_website_context>`;
}
