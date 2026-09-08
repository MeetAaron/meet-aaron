-- migration_prospect_handover_2026-09-07.sql
--
-- Passage de relais à la conversion en client (voir lib/prospect-handover.ts).
--
-- handed_over_at : horodatage du moment où Aaron a passé la main au
-- commercial sur ce contact devenu client. Sert de garde-fou d'idempotence —
-- plusieurs chemins peuvent marquer un prospect gagné (bouton « Gagné »,
-- étape « Client » du pipeline, commande détectée dans un email, webhook
-- externe), et le commercial ne doit être notifié qu'une seule fois.
--
-- Le passage en « géré par moi » lui-même réutilise la colonne existante
-- prospects.ai_managed (migration_customer_ai_managed_2026-08-17.sql) : rien
-- de nouveau à créer pour ça.

alter table public.prospects
  add column if not exists handed_over_at timestamptz;

comment on column public.prospects.handed_over_at is
  'Quand Aaron a passé la main au commercial après le passage en client (null = pas encore).';
