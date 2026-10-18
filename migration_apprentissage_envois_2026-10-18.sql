-- migration_apprentissage_envois_2026-10-18.sql
-- « Aaron apprend de tes résultats » (validé par Alex le 18/10/2026).
-- Une ligne par commercial, recalculée chaque semaine par le cron
-- /api/cron/compute-send-insights (lib/send-insights.ts) à partir des
-- emails sortants des 90 derniers jours et des réponses reçues dans les
-- 7 jours : taux de réponse par tranche horaire et par jour (heure locale
-- du commercial). Quand une tranche sort nettement du lot avec assez de
-- volume, Aaron y concentre ses envois (lib/send-window.ts) et le dit
-- dans Mes résultats.
CREATE TABLE IF NOT EXISTS send_insights (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL DEFAULT 90,
  sample_size integer NOT NULL DEFAULT 0,          -- emails sortants analysés
  overall_reply_rate numeric(6,4),                 -- réponses / envois sur la période
  by_hour jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{bucket:'8-10', sent, replied, rate, lift}]
  by_weekday jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{weekday:1..7, sent, replied, rate, lift}]
  learned_window jsonb,                            -- {hours:[[8,10],[10,12]], weekdays:[2,3]} ou NULL si pas assez de données
  timezone text
);

COMMENT ON TABLE send_insights IS
  'Taux de réponse par créneau d''envoi, par commercial. learned_window NULL = créneau par défaut (lun→ven 8 h–12 h).';
