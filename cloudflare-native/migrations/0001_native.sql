-- Original domain fields remain lossless JSON. Generated columns provide indexed tenant routing.
CREATE TABLE IF NOT EXISTS records (
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  company_id TEXT GENERATED ALWAYS AS (coalesce(json_extract(data,'$.companyId'),'')) STORED,
  user_id TEXT GENERATED ALWAYS AS (coalesce(json_extract(data,'$.userId'),'')) STORED,
  email TEXT GENERATED ALWAYS AS (lower(coalesce(json_extract(data,'$.email'),''))) STORED,
  period TEXT GENERATED ALWAYS AS (coalesce(json_extract(data,'$.month'),'')) STORED,
  PRIMARY KEY(table_name,record_id),
  CHECK(record_id=json_extract(data,'$.id'))
);
CREATE INDEX IF NOT EXISTS records_tenant ON records(company_id,table_name,ordinal);
CREATE INDEX IF NOT EXISTS records_user ON records(table_name,user_id);
CREATE INDEX IF NOT EXISTS records_email ON records(table_name,email);
CREATE INDEX IF NOT EXISTS records_month ON records(company_id,table_name,period);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO metadata VALUES('revision','0');
INSERT OR IGNORE INTO metadata VALUES('schema','1');
CREATE TABLE IF NOT EXISTS commit_guards (id TEXT NOT NULL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, trashed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS properties (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 status TEXT NOT NULL DEFAULT 'QUEUED', attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,available_at,lease_until);
CREATE TABLE IF NOT EXISTS request_receipts (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 response TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS migrations (
 id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL,
 counts TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON records(email) WHERE table_name='Users' AND email<>'';
