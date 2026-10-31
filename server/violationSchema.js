// Additive-only schema migration for Shopee violation management.
// Existing operational tables are never dropped or rewritten.
async function initViolationSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopee_violation_rule_versions (
      id BIGSERIAL PRIMARY KEY,
      version_name TEXT NOT NULL,
      source_document TEXT NOT NULL,
      document_updated_at DATE,
      effective_date DATE NOT NULL,
      expiry_date DATE,
      status TEXT NOT NULL DEFAULT '草稿'
        CHECK (status IN ('草稿','待覆核','已核准','停用')),
      created_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (expiry_date IS NULL OR expiry_date >= effective_date)
    );

    CREATE TABLE IF NOT EXISTS shopee_violation_rules (
      id BIGSERIAL PRIMARY KEY,
      version_id BIGINT NOT NULL REFERENCES shopee_violation_rule_versions(id),
      rule_code TEXT NOT NULL,
      category TEXT NOT NULL,
      rule_text TEXT NOT NULL,
      applicable_to TEXT NOT NULL DEFAULT '待確認',
      source_page INTEGER NOT NULL CHECK (source_page > 0),
      verification_status TEXT NOT NULL DEFAULT '待核對'
        CHECK (verification_status IN ('待核對','已核對')),
      verified_by TEXT,
      verified_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(version_id, rule_code)
    );

    CREATE TABLE IF NOT EXISTS shopee_violation_cases (
      id BIGSERIAL PRIMARY KEY,
      case_no TEXT NOT NULL UNIQUE,
      event_at TIMESTAMPTZ NOT NULL,
      fleet_id TEXT REFERENCES partner_fleets(id),
      driver_id TEXT REFERENCES drivers(id),
      order_id TEXT REFERENCES orders(id),
      shopee_route_id TEXT REFERENCES shopee_routes(id),
      assignment_id BIGINT REFERENCES shopee_assignments(id),
      rule_id BIGINT NOT NULL REFERENCES shopee_violation_rules(id),
      rule_version_id BIGINT NOT NULL REFERENCES shopee_violation_rule_versions(id),
      description TEXT NOT NULL,
      evidence_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '待主管覆核'
        CHECK (status IN ('待主管覆核','已覆核','申訴中','已結案')),
      responsibility TEXT CHECK (responsibility IN ('待確認','全責','部分責任','無責')),
      review_reason TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (fleet_id IS NOT NULL OR driver_id IS NOT NULL),
      CHECK (order_id IS NULL OR (shopee_route_id IS NULL AND assignment_id IS NULL))
    );

    CREATE TABLE IF NOT EXISTS shopee_violation_case_events (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES shopee_violation_cases(id),
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shopee_violation_appeals (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES shopee_violation_cases(id),
      appeal_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '待處理'
        CHECK (status IN ('待處理','成立','部分成立','不成立')),
      decision_reason TEXT,
      created_by TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shopee_violation_fines (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES shopee_violation_cases(id),
      payer_type TEXT NOT NULL CHECK (payer_type IN ('我方','合作車隊')),
      payee TEXT NOT NULL DEFAULT '蝦皮',
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'TWD',
      source_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '待人工確認'
        CHECK (status IN ('待人工確認','已確認','有爭議','已撤銷','已結清')),
      confirmed_by TEXT,
      confirmed_at TIMESTAMPTZ,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sv_cases_event_at ON shopee_violation_cases(event_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sv_cases_fleet ON shopee_violation_cases(fleet_id);
    CREATE INDEX IF NOT EXISTS idx_sv_cases_driver ON shopee_violation_cases(driver_id);
    CREATE INDEX IF NOT EXISTS idx_sv_events_case ON shopee_violation_case_events(case_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sv_appeals_case ON shopee_violation_appeals(case_id);
    CREATE INDEX IF NOT EXISTS idx_sv_fines_case ON shopee_violation_fines(case_id);
  `);
}

module.exports = { initViolationSchema };
