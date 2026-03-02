-- Migrate to usage-based billing model.
-- Replaces plan-based pricing tiers with a pure usage + credit balance model.

-- Add billing_model column to workspaces (replaces plan-based pricing tiers)
ALTER TABLE bf_workspaces ADD COLUMN billing_model TEXT;

-- Set all existing workspaces to usage-based billing model
UPDATE bf_workspaces SET billing_model = 'usage' WHERE billing_model IS NULL;

-- Index for efficient billing model queries
CREATE INDEX IF NOT EXISTS idx_bf_workspaces_billing_model ON bf_workspaces (billing_model);
