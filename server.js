require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.PUBLIC_BASE_URL || true }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static("."));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
    })
  : null;

function requireDatabase(res) {
  if (!pool) {
    res.status(503).json({ error: "Database is not configured yet." });
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const configuredToken = process.env.ADMIN_API_TOKEN;
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!configuredToken) {
    return res.status(503).json({ error: "Admin access is not configured. Set ADMIN_API_TOKEN in the server environment." });
  }
  if (!supplied || supplied.length !== configuredToken.length || supplied !== configuredToken) {
    return res.status(401).json({ error: "Admin authentication failed." });
  }
  next();
}

// Small per-process limit to prevent accidental rapid repeat sends.
const sendAttempts = new Map();
function limitSmsSends(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const recent = (sendAttempts.get(key) || []).filter(time => now - time < 60_000);
  if (recent.length >= 5) return res.status(429).json({ error: "Please wait a minute before sending more invitations." });
  recent.push(now);
  sendAttempts.set(key, recent);
  next();
}

app.get("/api/health", async (_req, res) => {
  let database = "not_configured";
  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = "connected";
    } catch (_error) {
      database = "error";
    }
  }
  res.json({ ok: true, service: "simglo-dataplus", database });
});

app.get("/api/store/bundles", async (_req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT id, network, name, data_amount, selling_price
       FROM bundles WHERE active = TRUE ORDER BY network, sort_order, data_amount`
    );
    res.json({ bundles: result.rows });
  } catch (_error) {
    res.status(500).json({ error: "Could not load bundles." });
  }
});

app.post("/api/admin/sms/agent-invitation", requireAdmin, limitSmsSends, async (req, res) => {
  if (!requireDatabase(res)) return;
  const rawPhone = String(req.body.phone || "").trim();
  const consent = req.body.consent === true;
  if (!consent) return res.status(400).json({ error: "Confirm that the recipient agreed to receive this invitation before sending." });

  let phone = rawPhone.replace(/[\s()-]/g, "");
  if (/^0\d{9}$/.test(phone)) phone = `+233${phone.slice(1)}`;
  else if (/^233\d{9}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+233\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Enter a valid Ghana number, for example 0241234567 or +233241234567." });
  }

  const clientId = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  const senderId = process.env.HUBTEL_SENDER_ID || "SIMGLO";
  const publicUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const registrationUrl = process.env.AGENT_REGISTRATION_URL || `${publicUrl}/#agents`;
  if (!clientId || !clientSecret || !publicUrl) {
    return res.status(503).json({ error: "SMS is not configured yet. Add Hubtel credentials and PUBLIC_BASE_URL in Render." });
  }
  if (senderId.length > 11) {
    return res.status(400).json({ error: "Hubtel sender IDs must be 11 characters or fewer. Use an approved name such as SIMGLO." });
  }

  const content = `Join Simglo Dataplus as a data bundle agent. Register or enquire here: ${registrationUrl}`;
  let providerMessageId = null;
  let providerRate = null;
  let providerUnits = null;
  let providerCost = null;
  let sendStatus = "failed";
  let errorMessage = null;
  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(process.env.HUBTEL_SMS_URL || "https://smsc.hubtel.com/v1/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
      body: JSON.stringify({ from: senderId, to: phone, content })
    });
    const bodyText = await response.text();
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (_error) { body = { message: bodyText.slice(0, 300) }; }
    if (!response.ok) throw new Error(body.message || body.Message || `SMS provider returned HTTP ${response.status}`);
    const data = body?.data || body?.Data || {};
    sendStatus = "submitted";
    providerMessageId = data.messageId || data.MessageId || null;
    const rawRate = data.rate ?? data.Rate;
    const rawUnits = data.units ?? data.Units;
    if (rawRate !== undefined && Number.isFinite(Number(rawRate))) providerRate = Number(rawRate);
    if (rawUnits !== undefined && Number.isFinite(Number(rawUnits))) providerUnits = Number(rawUnits);
    // Only calculate spend when Hubtel returns both the rate and billable units.
    if (providerRate !== null && providerUnits !== null) providerCost = providerRate * providerUnits;
  } catch (error) {
    errorMessage = String(error.message || "SMS sending failed").slice(0, 500);
  }

  try {
    await pool.query(
      `INSERT INTO sms_invitation_logs
       (phone_number, sender_id, message, status, provider_message_id, provider_rate, provider_units, provider_cost, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [phone, senderId, content, sendStatus, providerMessageId, providerRate, providerUnits, providerCost, errorMessage]
    );
  } catch (_error) {
    // Do not expose credentials or provider internals if logging fails.
  }

  if (sendStatus === "failed") return res.status(502).json({ error: `The SMS could not be submitted: ${errorMessage || "provider error"}` });
  res.json({ ok: true, status: "submitted", message: "Invitation submitted to the SMS provider. Delivery may take a short time." });
});

app.get("/api/admin/sms/stats", requireAdmin, async (_req, res) => {
  if (!requireDatabase(res)) return;
  const configuredRate = Number(process.env.HUBTEL_ESTIMATED_COST_PER_SMS_GHS || 0.033);
  const fallbackRate = Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : 0.033;
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total_invitations,
        COUNT(*) FILTER (WHERE status = 'submitted')::int AS total_submitted,
        COUNT(*) FILTER (WHERE status = 'submitted' AND created_at >= date_trunc('month', NOW()))::int AS month_submitted,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS total_failed,
        COUNT(*) FILTER (WHERE status = 'submitted' AND provider_cost IS NOT NULL)::int AS messages_with_cost,
        COALESCE(SUM(provider_cost), 0)::numeric(12,6)::text AS recorded_spend_ghs
      FROM sms_invitation_logs
    `);
    const row = result.rows[0] || {};
    const submitted = Number(row.total_submitted || 0);
    const withCost = Number(row.messages_with_cost || 0);
    const recordedSpend = Number(row.recorded_spend_ghs || 0);
    // For submissions where Hubtel did not return billing details, show a clearly
    // labelled estimate using the admin-configured fallback rate.
    const estimatedSpend = recordedSpend + Math.max(0, submitted - withCost) * fallbackRate;
    res.json({
      total_invitations: Number(row.total_invitations || 0),
      total_submitted: submitted,
      month_submitted: Number(row.month_submitted || 0),
      total_failed: Number(row.total_failed || 0),
      recorded_spend_ghs: recordedSpend,
      estimated_spend_ghs: Number(estimatedSpend.toFixed(4)),
      estimated_rate_per_sms_ghs: fallbackRate,
      live_balance_available: false
    });
  } catch (_error) {
    res.status(500).json({ error: "Could not load SMS usage. Run the latest db/schema.sql migration." });
  }
});

// Sales reports use database records only; no estimated or invented sales.
// A sale is counted only after payment is confirmed and fulfilment is delivered.
app.get("/api/admin/sales/reports", requireAdmin, async (_req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(`
      WITH periods AS (
        SELECT 'week'::text AS period, date_trunc('week', NOW()) AS starts_at
        UNION ALL SELECT 'month', date_trunc('month', NOW())
        UNION ALL SELECT 'year', date_trunc('year', NOW())
      )
      SELECT periods.period,
        COUNT(orders.id)::int AS orders,
        COALESCE(SUM(orders.total_amount), 0)::numeric(14,2)::text AS sales_ghs,
        CASE WHEN COUNT(orders.id) FILTER (WHERE orders.supplier_cost IS NULL) > 0 THEN NULL
          ELSE COALESCE(SUM(orders.total_amount - orders.supplier_cost), 0)::numeric(14,2)::text END AS profit_ghs
      FROM periods LEFT JOIN orders
        ON orders.created_at >= periods.starts_at
       AND orders.payment_status = 'paid'
       AND orders.fulfilment_status = 'delivered'
      GROUP BY periods.period, periods.starts_at ORDER BY periods.starts_at
    `);
    const reports = {};
    for (const row of result.rows) reports[row.period] = {
      orders: Number(row.orders || 0), sales_ghs: Number(row.sales_ghs || 0),
      profit_ghs: row.profit_ghs === null ? null : Number(row.profit_ghs)
    };
    res.json({ ...reports, generated_at: new Date().toISOString(), currency: "GHS" });
  } catch (_error) {
    res.status(500).json({ error: "Could not load sales reports. Run the latest db/schema.sql migration first." });
  }
});

// Disabled until secure agent authentication and ownership checks are implemented.
app.get("/api/agent/sales/reports", (_req, res) => {
  res.status(501).json({ error: "Agent reports are prepared, but secure agent sign-in and ownership checks must be completed before personal sales data can be shown." });
});

app.get("/api/admin/sms/logs", requireAdmin, async (_req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT id, phone_number, sender_id, status, provider_message_id, provider_rate, provider_units, provider_cost, error_message, created_at
       FROM sms_invitation_logs ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ messages: result.rows });
  } catch (_error) {
    res.status(500).json({ error: "Could not load SMS history. Run the latest database schema." });
  }
});

// Supplier data is never invented. Implement the provider adapter only after
// the chosen supplier's real API documentation and credentials are supplied.
app.post("/api/admin/supplier/fetch", requireAdmin, (_req, res) => {
  if (!process.env.SUPPLIER_BASE_URL || !process.env.SUPPLIER_API_KEY) {
    return res.status(503).json({ error: "Supplier API is not configured. Add the real supplier credentials first." });
  }
  res.status(501).json({ error: "Supplier credentials are present, but the provider-specific fetch adapter has not been implemented." });
});

app.get("/api/admin/settings/public", async (_req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      "SELECT customer_service_whatsapp, whatsapp_channel_url FROM site_settings WHERE id = 1"
    );
    res.json({ settings: result.rows[0] || {} });
  } catch (_error) {
    res.status(500).json({ error: "Could not load site settings." });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Simglo Dataplus running on port ${port}`));
