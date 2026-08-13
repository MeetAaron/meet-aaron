// lib/customer-health.ts
// Calcul du score de santé d'un client gagné (0-100). Volontairement 100%
// déterministe et SANS appel à Claude : contrairement au reste d'Aaron
// Customer (onboarding, check-ins), ce score doit être rapide à recalculer
// pour tous les clients chaque jour (cron), gratuit, et parfaitement
// reproductible pour qu'un commercial puisse comprendre pourquoi il bouge.
// Utilisé par app/api/cron/customer-health/route.ts et par
// app/api/customers/pipeline/route.ts (affichage).

export type HealthLabel = 'saine' | 'a_surveiller' | 'a_risque';

export const HEALTH_LABEL_META: Record<HealthLabel, { label: string; color: string }> = {
  saine: { label: 'Santé saine', color: '#3DD68C' },
  a_surveiller: { label: 'À surveiller', color: '#F0C94E' },
  a_risque: { label: 'À risque', color: '#E5484D' },
};

interface HealthInput {
  wonAt: string | null;
  onboardingStatus: 'a_demarrer' | 'en_cours' | 'termine' | null;
  lastCheckin: {
    sentAt: string | null;
    respondedAt: string | null;
    responseScore: number | null; // 0-10
  } | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// Score de départ pour un client tout juste signé : ni "sain" ni "à risque"
// tant qu'on n'a pas de signal — on ne veut pas alerter sur un client de
// 3 jours qui n'a simplement pas encore eu le temps de répondre à quoi que
// ce soit.
const BASE_SCORE = 70;

export function computeHealthScore(input: HealthInput): { score: number; label: HealthLabel } {
  let score = BASE_SCORE;
  const daysSinceWon = daysSince(input.wonAt);

  // Onboarding : un onboarding qui traîne est un signal d'alerte précoce,
  // souvent plus révélateur qu'une note de satisfaction (qui arrive plus tard).
  if (input.onboardingStatus === 'termine') {
    score += 15;
  } else if (input.onboardingStatus === 'a_demarrer' && daysSinceWon !== null && daysSinceWon > 14) {
    score -= 20; // onboarding jamais démarré 2 semaines après la signature
  } else if (input.onboardingStatus === 'en_cours' && daysSinceWon !== null && daysSinceWon > 30) {
    score -= 10; // onboarding en cours depuis plus d'un mois, ça traîne
  }

  // Dernier check-in satisfaction/NPS
  if (input.lastCheckin) {
    if (input.lastCheckin.responseScore !== null) {
      if (input.lastCheckin.responseScore >= 9) {
        score += 15; // promoteur
      } else if (input.lastCheckin.responseScore <= 6) {
        score -= 25; // détracteur — signal le plus fort du modèle
      }
      // 7-8 (passif) : neutre, pas d'ajustement
    } else if (input.lastCheckin.sentAt && !input.lastCheckin.respondedAt) {
      const daysSinceSent = daysSince(input.lastCheckin.sentAt);
      if (daysSinceSent !== null && daysSinceSent > 10) {
        score -= 15; // silence prolongé après une sollicitation directe
      }
    }
  }

  score = Math.max(0, Math.min(100, score));

  let label: HealthLabel;
  if (score >= 70) label = 'saine';
  else if (score >= 45) label = 'a_surveiller';
  else label = 'a_risque';

  return { score, label };
}
