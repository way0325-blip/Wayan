CREATE TABLE google_source_oauth_clients (
 id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id),
 client_id TEXT NOT NULL,
 secret_encrypted TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE google_source_oauth_connections (
 id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id),
 email TEXT NOT NULL,
 refresh_encrypted TEXT NOT NULL,
 scopes TEXT NOT NULL,
 last_error TEXT NOT NULL DEFAULT '',
 connected_by TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE google_source_oauth_pending (
 state_hash TEXT PRIMARY KEY,
 cookie_hash TEXT NOT NULL,
 nonce TEXT NOT NULL,
 verifier_encrypted TEXT NOT NULL,
 actor TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
