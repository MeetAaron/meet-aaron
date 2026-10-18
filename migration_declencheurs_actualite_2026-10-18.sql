-- migration_declencheurs_actualite_2026-10-18.sql
-- « Déclencheurs d'actualité » (validé par Alex le 18/10/2026).
-- Pour les prospects restés silencieux (classés « sans réponse »), Aaron
-- surveille l'actualité publique de leur société (recrutement, ouverture,
-- nouveau dirigeant, levée de fonds, lancement, prix…). Quand il trouve
-- quelque chose de récent et vérifiable, il prépare une relance motivée par
-- cette actualité et la soumet au commercial (même circuit que la tentative
-- de sauvetage : rien ne part sans validation). Voir lib/news-triggers.ts.

-- Côté société : la dernière actualité repérée et la date du dernier
-- contrôle (une recherche web par société, au plus une fois par mois).
ALTER TABLE prospect_companies ADD COLUMN IF NOT EXISTS news_signal text;         -- une phrase factuelle, ou NULL
ALTER TABLE prospect_companies ADD COLUMN IF NOT EXISTS news_signal_url text;     -- source
ALTER TABLE prospect_companies ADD COLUMN IF NOT EXISTS news_signal_at timestamptz; -- quand l'actualité a été repérée
ALTER TABLE prospect_companies ADD COLUMN IF NOT EXISTS news_checked_at timestamptz; -- dernier contrôle (même sans résultat)

-- Côté prospect : d'où vient la proposition en attente ('actualite' quand
-- elle vient de ce module, NULL pour une tentative de sauvetage classique),
-- et la date de la dernière relance d'actualité proposée (une par prospect
-- par trimestre au plus).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS rescue_proposal_source text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS news_trigger_at timestamptz;

CREATE INDEX IF NOT EXISTS prospects_news_trigger_candidates_idx
  ON prospects (assigned_user_id, lost_at)
  WHERE is_lost = true AND pipeline_lost_reason = 'sans_reponse';

COMMENT ON COLUMN prospect_companies.news_signal IS
  'Actualité publique récente repérée par Aaron (lib/news-triggers.ts). NULL = rien trouvé au dernier contrôle.';
COMMENT ON COLUMN prospects.rescue_proposal_source IS
  '''actualite'' quand la proposition en attente est une relance motivée par une actualité de la société ; NULL sinon.';
