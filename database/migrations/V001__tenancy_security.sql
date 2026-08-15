-- ============================================================================
-- V001 — Socle SaaS : tenants, utilisateurs, licences, sécurité des sessions,
--        audit, configurations et notifications. (corrige ARC-04/05, DAT-06/07,
--        SEC-02/08/10)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid() natif PG13+

CREATE TABLE IF NOT EXISTS plans (
    code          VARCHAR(30) PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    max_users     INTEGER NOT NULL DEFAULT 5,
    max_depots    INTEGER NOT NULL DEFAULT 1,
    monthly_price NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0)
);

CREATE TABLE IF NOT EXISTS tenants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    subdomain     VARCHAR(100) UNIQUE,
    logo          TEXT,                    -- data-URL ou URL maîtrisée
    primary_color VARCHAR(20) DEFAULT '#059669',
    phone         VARCHAR(50),
    currency      VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    timezone      VARCHAR(64) NOT NULL DEFAULT 'Africa/Douala',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email         VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    name          VARCHAR(255) NOT NULL,
    role          VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','VENDEUR')),
    depot_id      UUID,                    -- contrainte ajoutée après table depots
    pin_hash      TEXT,                    -- hash bcrypt, JAMAIS en clair (SEC-10)
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- L'email est la clé de connexion : globalement unique, normalisé en minuscules
-- à l'écriture (zod .toLowerCase() côté API) — détecte EMAIL_TAKEN (SEC-10/DAT-02).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS depots (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    address    TEXT,
    phone      VARCHAR(50),
    owner_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_user_depot;
ALTER TABLE users ADD CONSTRAINT fk_user_depot
    FOREIGN KEY (depot_id) REFERENCES depots(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS licenses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_code  VARCHAR(30) NOT NULL REFERENCES plans(code),
    status     VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
               CHECK (status IN ('TRIAL','ACTIVE','EXPIRED','SUSPENDED')),
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    max_users  INTEGER NOT NULL DEFAULT 5,
    max_depots INTEGER NOT NULL DEFAULT 1,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id, end_date DESC);

-- Refresh tokens opaques, rotatifs, révocables (SEC-08)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,      -- sha256 du jeton opaque
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    replaced_by UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- Journal d'audit alimenté par le helper lib/audit.ts (DAT-06)
CREATE TABLE IF NOT EXISTS audit_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name      VARCHAR(255),
    action         VARCHAR(60) NOT NULL,   -- CREATE/UPDATE/DELETE/VOID/LOGIN/…
    entity         VARCHAR(60) NOT NULL,
    entity_id      VARCHAR(64),
    previous_state JSONB,
    new_state      JSONB,
    details        TEXT,
    depot_id       UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(tenant_id, entity, entity_id);

-- Clés API globales (éditeur) — secrets jamais renvoyés en clair (SEC-04)
CREATE TABLE IF NOT EXISTS system_configs (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    "group"     VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
    description TEXT,
    is_secret   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configuration par tenant (destinataires d'alertes, préférences)
CREATE TABLE IF NOT EXISTS tenant_configs (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key       VARCHAR(100) NOT NULL,
    value     TEXT NOT NULL DEFAULT '',
    is_secret BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS notification_settings (
    tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    alert_phone          VARCHAR(50),
    alert_whatsapp       VARCHAR(50),
    low_stock_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    expiry_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    daily_report_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    daily_report_time    TIME NOT NULL DEFAULT '20:00'
);

-- Historique des envois + exactly-once par clé de dédup (BCK-01/BCK-07)
CREATE TABLE IF NOT EXISTS notifications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    phone             VARCHAR(50),
    type              VARCHAR(40) NOT NULL,  -- LOW_STOCK/EXPIRY/DAILY_REPORT/SYSTEM/SYNC_FAILURE
    channel           VARCHAR(20) NOT NULL,  -- IN_APP/SMS/WHATSAPP
    message           TEXT NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','SENT','FAILED','READ')),
    provider_response JSONB,
    dedupe_key        TEXT,                  -- ex. LOW_STOCK:2026-08-02:<productId>
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
    ON notifications(tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, created_at DESC);
