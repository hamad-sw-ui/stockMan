-- Seed PRODUCTION : plans commerciaux StockMan (idempotent)
INSERT INTO plans (code, name, max_users, max_depots, monthly_price) VALUES
  ('TRIAL', 'Essai gratuit', 2, 1, 0),
  ('BASIC', 'Basique', 5, 1, 5000),
  ('PRO',   'Professionnel', 20, 5, 15000)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, max_users = EXCLUDED.max_users,
  max_depots = EXCLUDED.max_depots, monthly_price = EXCLUDED.monthly_price;
