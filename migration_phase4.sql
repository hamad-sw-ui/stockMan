-- MIGRATION POUR LA PHASE 4 : CONNECTIVITÉ & INTELLIGENCE

-- 1. TABLE SYSTEM_CONFIGS (Stockage sécurisé des clés API)
CREATE TABLE IF NOT EXISTS system_configs (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    "group" VARCHAR(50) NOT NULL, -- 'API', 'SYSTEM', 'SECURITY'
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insertion des clés par défaut (vides)
INSERT INTO system_configs (key, value, "group", description) VALUES
('whatsapp_api_token', '', 'API', 'Token d''accès Meta pour WhatsApp Business API'),
('whatsapp_phone_number_id', '', 'API', 'ID du numéro de téléphone WhatsApp'),
('sms_api_key', '', 'API', 'Clé API Africa''s Talking'),
('sms_username', 'sandbox', 'API', 'Nom d''utilisateur Africa''s Talking (sandbox/prod)')
ON CONFLICT (key) DO NOTHING;

-- 2. TABLE NOTIFICATIONS (Historique des envois)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Destinataire interne (optionnel)
    phone VARCHAR(50), -- Destinataire externe (SMS/WhatsApp)
    type VARCHAR(50) NOT NULL, -- 'STOCK_ALERT', 'SALES_REPORT', 'SYSTEM'
    channel VARCHAR(20) NOT NULL, -- 'SMS', 'WHATSAPP', 'PUSH', 'EMAIL'
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING', -- 'SENT', 'FAILED', 'PENDING'
    provider_response JSONB, -- Réponse de l'API externe pour debug
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
