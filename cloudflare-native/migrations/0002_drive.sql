-- Private provider metadata and encrypted OAuth credentials; no public access.
CREATE TABLE IF NOT EXISTS integrations (
 key TEXT PRIMARY KEY, encrypted TEXT NOT NULL, public_json TEXT NOT NULL CHECK(json_valid(public_json)), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS file_locations (
 id TEXT PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE, folder_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 sha256 TEXT NOT NULL, size INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'RESERVED', created_at TEXT NOT NULL
);
