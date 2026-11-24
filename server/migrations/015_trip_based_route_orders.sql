-- Fixed route trips are priced per trip; unknown stop quantities stay NULL.
-- Existing quantities and constraints on non-NULL quantities are preserved.
ALTER TABLE delivery_orders ALTER COLUMN quantity DROP NOT NULL;
