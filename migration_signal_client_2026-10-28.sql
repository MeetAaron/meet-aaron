-- 28/10/2026 — « Client à confirmer » (validé par Alex).
-- Un accord écrit lu dans un email, une notification de paiement ou de
-- signature reçue dans la boîte du commercial ne fait PLUS basculer le
-- contact en client tout seul : Aaron pose la question dans une story, le
-- commercial confirme ou rejette. Ces colonnes portent le signal en attente.
-- Tout le code a un repli si elles n'existent pas encore.
alter table prospects add column if not exists client_signal_detected_at timestamptz;
alter table prospects add column if not exists client_signal_source text;      -- 'accord_email' | 'paiement' | 'signature_plateforme'
alter table prospects add column if not exists client_signal_reason text;      -- phrase courte d'Aaron (ex. « a écrit "bon pour accord" le 28/10 »)
alter table prospects add column if not exists client_signal_message_id text;  -- identifiant du message déclencheur (évite les doublons)
alter table prospects add column if not exists client_signal_dismissed_at timestamptz;
