CREATE TABLE IF NOT EXISTS bundles (
  id BIGSERIAL PRIMARY KEY,
  network VARCHAR(20) NOT NULL CHECK (network IN ('MTN','Telecel','AT')),
  name VARCHAR(100) NOT NULL,
  data_amount VARCHAR(50) NOT NULL,
  supplier_price NUMERIC(12,2),
  selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  customer_service_whatsapp VARCHAR(30),
  whatsapp_channel_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sms_invitation_logs (
  id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL,
  sender_id VARCHAR(11) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('submitted','failed')),
  provider_message_id VARCHAR(150),
  provider_rate NUMERIC(12,6),
  provider_units NUMERIC(12,4),
  provider_cost NUMERIC(12,6),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Safe migration for databases created with an earlier starter schema.
ALTER TABLE sms_invitation_logs ADD COLUMN IF NOT EXISTS provider_rate NUMERIC(12,6);
ALTER TABLE sms_invitation_logs ADD COLUMN IF NOT EXISTS provider_units NUMERIC(12,4);
ALTER TABLE sms_invitation_logs ADD COLUMN IF NOT EXISTS provider_cost NUMERIC(12,6);
CREATE INDEX IF NOT EXISTS sms_invitation_logs_created_at_idx ON sms_invitation_logs (created_at DESC);

-- Planned next migrations:
-- agents, personal stores, agent pricing, orders, Paystack references,
-- wallet_transactions, withdrawal requests, supplier sync logs and audit logs.
-- Do not enable live purchases until payment verification, authorization,
-- idempotency, supplier delivery and reconciliation are implemented and tested.


-- Initial agent and order tables for sales attribution and reports.
-- Checkout/payment verification and supplier fulfilment must be implemented
-- server-side before real orders are inserted into this table.
CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_reference VARCHAR(100) UNIQUE NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  bundle_id BIGINT REFERENCES bundles(id),
  agent_id BIGINT REFERENCES agents(id),
  store_id BIGINT,
  network VARCHAR(20) NOT NULL CHECK (network IN ('MTN','Telecel','AT')),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  supplier_cost NUMERIC(14,2) CHECK (supplier_cost IS NULL OR supplier_cost >= 0),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  fulfilment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (fulfilment_status IN ('pending','processing','delivered','failed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_reporting_idx ON orders (created_at DESC, payment_status, fulfilment_status);
CREATE INDEX IF NOT EXISTS orders_agent_reporting_idx ON orders (agent_id, created_at DESC, payment_status, fulfilment_status);
