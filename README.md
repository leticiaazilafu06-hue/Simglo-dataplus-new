# Simglo Dataplus — starter foundation

Black/red mobile-friendly storefront and Express/PostgreSQL API foundation, with a protected admin SMS invitation page.

## Run locally
1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env` and fill in database and admin settings.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` for the storefront and `http://localhost:3000/admin.html` for the admin SMS invitation page.
6. Run `db/schema.sql` against the PostgreSQL database.

## Agent invitation SMS
- Open `/admin.html`, enter the `ADMIN_API_TOKEN` configured on the server, and save it for the browser session.
- Enter one Ghana mobile number and confirm that the person agreed to receive the invitation.
- The backend normalizes Ghana numbers and sends the invitation through Hubtel Programmable SMS.
- Add `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_SENDER_ID`, `PUBLIC_BASE_URL` and (optionally) `AGENT_REGISTRATION_URL` to Render environment variables.
- Run the latest `db/schema.sql` so SMS invitation history can be stored.
- Hubtel credentials remain server-side. Never put them in browser JavaScript or commit them to GitHub.
- The provider response means the message was submitted, not necessarily delivered. Check delivery reports in Hubtel.
- Only send invitations to people who have agreed to receive them. Avoid unsolicited bulk messaging.

### Sender name limitation
Hubtel's published sender-ID guidance says sender IDs are subject to approval and must be 11 characters or fewer. Therefore the full text `Simglo Dataplus` is too long for that sender-ID field. Request approval for a short brand identifier such as `SIMGLO` (subject to availability and Hubtel/network approval). The message body can still say Simglo Dataplus.

## Important implementation status
This is a starter, not a finished live-commerce system.
- Public storefront and health endpoint are scaffolded.
- Bundle listing reads from PostgreSQL.
- Admin SMS invitation page and protected server endpoint are implemented for Hubtel, once credentials, sender approval and database are configured.
- SMS history is stored in PostgreSQL. The admin dashboard shows invitation totals, Hubtel-submitted and failed counts, and recorded spend when Hubtel returns both a rate and billable-unit count. It does not invent costs when the provider response omits those fields.
- The current published Hubtel SMS API documentation describes sending and querying message status but does not document a wallet-balance endpoint for this integration. The dashboard therefore links to Hubtel for the authoritative live SMS credit balance instead of displaying a made-up balance. Check Hubtel's account portal and downloadable reports for final charges.
- Run the latest `db/schema.sql` after updating; it safely adds the provider rate/unit/cost columns to an existing SMS log table.
- The default invitation link points to the public `#agents` section. Set `AGENT_REGISTRATION_URL` to the real agent registration page once that workflow is implemented.
- Supplier fetch deliberately refuses to invent supplier data. It needs the actual supplier's API documentation, endpoint, authentication method and response format.
- Paystack checkout/webhook verification, full admin authentication and settings, agent registration/approval, agent stores, wallets, withdrawals and order fulfilment still need implementation and testing.
- The GH₵2 withdrawal fee remains a product requirement, not an active deduction.
- Do not accept customer payments or promise automatic data delivery until payment and supplier workflows are implemented and tested.

## Deployment and security
- On Render, add environment variables from `.env.example` using your own values. Do not upload `.env`.
- Generate a long random `ADMIN_API_TOKEN` and keep it private. The admin page is at `/admin.html`; do not share the token.
- Use a strong, private GitHub repository while the project is under development.
- Never commit `.env`, Hubtel credentials, supplier API keys, Paystack secret keys, database passwords or admin tokens.
- The admin token is a simple single-admin access gate for this starter. Before opening the admin dashboard to a wider team, replace it with full user accounts, roles, session expiry and audit controls.


## SMS usage tracking

The admin SMS page includes total invitations, submissions this month, failed submissions, and estimated SMS spend. The estimate uses Hubtel-reported rate and billable-unit details where returned, then uses `HUBTEL_ESTIMATED_COST_PER_SMS_GHS` (default `0.033`) for submitted messages where those details are unavailable. This remains a planning estimate: charges can vary by selected gateway, destination network, and message segments. Check the Hubtel account portal and reports for the actual prepaid SMS balance and final billed amount; the documented SMS API does not expose a verified live balance endpoint for this starter.


## Sales reports (new in this update)
- Admin dashboard: weekly, monthly and yearly whole-business sales and profit summaries.
- Sales include only orders marked `payment_status = paid` and `fulfilment_status = delivered`.
- Profit is calculated from order total minus recorded supplier cost. If any included order in a period has no supplier cost, that period's profit is shown as unavailable instead of overstated.
- Added initial `agents` and `orders` tables to support agent attribution and future personal reporting.
- Agent report page is prepared at `/agent.html`. Secure agent registration/login, checkout, payment verification and fulfilment are not implemented yet. The personal agent report API intentionally remains disabled until ownership checks exist, so agents cannot access one another's data.
- After uploading this update, run the latest complete `db/schema.sql` against Render PostgreSQL. It preserves existing tables and adds the new reporting tables/indexes.
- Reports will show zero until real successful orders are recorded. Do not treat pending, failed, cancelled or refunded orders as sales.
