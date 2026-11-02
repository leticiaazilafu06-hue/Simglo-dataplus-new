
-- SIMGLO DATAPLUS: AGENT SYSTEM MIGRATION

-- 1. Extend the existing agent accounts table.
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS username VARCHAR(40);

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Case-insensitive uniqueness for usernames and emails.
CREATE UNIQUE INDEX IF NOT EXISTS agents_email_lower_uidx
ON agents (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS agents_username_lower_uidx
ON agents (LOWER(username))
WHERE username IS NOT NULL;

-- 2. One personal store per agent.
CREATE TABLE IF NOT EXISTS agent_stores (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  store_name VARCHAR(120) NOT NULL,
  store_slug VARCHAR(60) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Each agent's own resale price for each bundle.
CREATE TABLE IF NOT EXISTS agent_store_prices (
  id BIGSERIAL PRIMARY KEY,
  store_id BIGINT NOT NULL REFERENCES agent_stores(id) ON DELETE CASCADE,
  bundle_id BIGINT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  resale_price NUMERIC(12,2) NOT NULL CHECK (resale_price > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, bundle_id)
);

CREATE INDEX IF NOT EXISTS agent_store_prices_bundle_idx
ON agent_store_prices (bundle_id);

-- 4. Preserve the prices charged on each order.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS agent_purchase_price NUMERIC(14,2);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS resale_price NUMERIC(14,2);

-- 5. Link existing order store_id field to agent stores.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_store_id_fkey'
  ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT orders_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES agent_stores(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agent_stores_slug_idx
ON agent_stores (store_slug);
