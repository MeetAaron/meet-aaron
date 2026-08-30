-- migration_domain_health_cache_2026-08-30.sql
-- Cache (24h) du résultat de la vérification SPF/DMARC d'un domaine pro
-- connecté, utilisé par le nouveau blocage strict des envois de prospection
-- (lib/email-deliverability.ts -> isDomainHealthyForSending, lib/messaging.ts
-- -> DomainNotDeliverableError). Demande Alex (30/08/2026) : "je veux un vrai
-- blocage [...] que j'utilise un email pro avec google ou outlook je veux
-- que ça fonctionne à chaque fois".

alter table oauth_connections
  add column if not exists domain_health_ok boolean,
  add column if not exists domain_health_checked_at timestamptz;

comment on column oauth_connections.domain_health_ok is
  'Dernier résultat du contrôle SPF+DMARC du domaine de cette connexion (null = jamais vérifié, domaine grand public non concerné). Rafraîchi automatiquement si absent ou vieux de plus de 24h, voir lib/email-deliverability.ts.';
comment on column oauth_connections.domain_health_checked_at is
  'Date du dernier contrôle SPF+DMARC ayant renseigné domain_health_ok.';
