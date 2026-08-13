// lib/appointment-outcome.ts
// Enregistre le bilan d'un RDV une fois que le commercial a répondu à la
// question d'Aaron ("comment ça s'est passé ?"), et fait réagir Aaron :
// courte note d'encouragement/conseil + mise à jour du statut du prospect.
//
// Aaron Sales (2026-08-13) : ce bilan est aussi le déclencheur de la mise à
// jour AUTOMATIQUE du pipeline de vente (prospects.deal_stage), sans
// ressaisie manuelle du commercial — voir migration_aaron_sales_2026-08-13.sql
// et app/app/sales/page.jsx. Avant ce changement, un RDV "client" ne faisait
// jamais passer is_won à true nulle part dans le code (seul un passage
// manuel via l'action "marquer_gagne" le faisait) : ce trou est comblé ici.

import { supabaseAdmin } from './supabase-admin';
import { callClaude, MonthlyCapExceededError } from './anthropic-client';

export type AppointmentOutcome = 'client' | 'bien_passe' | 'moyen' | 'perdu';

const OUTCOME_LABELS: Record<AppointmentOutcome, string> = {
  client: 'Client signé',
  bien_passe: 'Plutôt bien passé',
  moyen: 'Moyennement, à relancer',
  perdu: 'Perdu',
};

// Statut du prospect (voir la légende dans app/app/prospects/page.jsx :
// vert = en bonne voie, jaune = en cours, orange = risque de perdre,
// rouge = perdu, bleu = RDV obtenu). Un "client" gagné est le meilleur cas
// possible : on le range en 'vert', faute d'une couleur dédiée "gagné" dans
// le pipeline actuel.
const OUTCOME_TO_PROSPECT_STATUS: Record<AppointmentOutcome, string> = {
  client: 'vert',
  bien_passe: 'vert',
  moyen: 'orange',
  perdu: 'rouge',
};

const FALLBACK_NOTES: Record<AppointmentOutcome, string> = {
  client: "Bravo, un client de plus ! Pense à lancer l'onboarding/le contrat sans trop tarder pendant que c'est chaud.",
  bien_passe: "Top, garde le momentum : une relance courte dans les prochains jours pour caler la suite peut faire la différence.",
  moyen: "Pas de souci, ça arrive — une relance dans une semaine avec un angle différent (étude de cas, offre limitée...) peut relancer l'intérêt.",
  perdu: "Dommage pour celui-là. Si tu as une minute, note pourquoi (prix, timing, concurrent...) — ça aide à mieux cibler les prochains.",
};

export async function recordAppointmentOutcome(appointmentId: string, outcome: AppointmentOutcome) {
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, prospect_id, prospects(id, full_name, company_id, deal_stage)')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    throw new Error('RDV introuvable');
  }

  const prospect = (appointment as any).prospects;
  const companyId = prospect?.company_id || null;

  let note = FALLBACK_NOTES[outcome];

  // La note personnalisée d'Aaron est un "bonus" — si le plafond API est
  // atteint ou que l'appel échoue pour une autre raison, on retombe
  // silencieusement sur une note générique plutôt que de bloquer
  // l'enregistrement du bilan (l'essentiel : le statut du prospect est à jour).
  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, copilote commercial IA. Le commercial vient de te dire qu'un RDV avec le prospect ` +
              `"${prospect?.full_name || 'un prospect'}" s'est soldé par : "${OUTCOME_LABELS[outcome]}".\n` +
              `Réagis en 1 à 2 phrases maximum, ton chaleureux et direct, avec un conseil concret pour la suite. ` +
              `Réponds uniquement avec ce message, en français, sans préambule ni titre.`,
          },
        ],
      },
      companyId
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    if (textBlock?.text?.trim()) {
      note = textBlock.text.trim();
    }
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur génération note de bilan RDV:', err.message);
    }
  }

  await supabaseAdmin
    .from('appointments')
    .update({ outcome, outcome_note: note, outcome_recorded_at: new Date().toISOString() })
    .eq('id', appointmentId);

  if (prospect?.id) {
    const now = new Date().toISOString();
    const prospectUpdate: Record<string, any> = { status: OUTCOME_TO_PROSPECT_STATUS[outcome] };

    if (outcome === 'client') {
      // Affaire signée : referme le pipeline et fait passer le prospect en
      // "client gagné" (jusqu'ici uniquement possible via l'action manuelle
      // "marquer_gagne" — voir app/api/prospects/[id]/route.ts).
      prospectUpdate.deal_stage = 'signe';
      prospectUpdate.deal_stage_updated_at = now;
      prospectUpdate.is_won = true;
      prospectUpdate.won_at = now;
      prospectUpdate.is_lost = false;
    } else if (outcome === 'perdu') {
      prospectUpdate.deal_stage = 'perdu';
      prospectUpdate.deal_stage_updated_at = now;
      prospectUpdate.is_lost = true;
      prospectUpdate.lost_at = now;
    } else {
      // bien_passe / moyen : le prospect vient de passer un RDV, donc au
      // moins "rdv_fait" — sans écraser une étape déjà plus avancée (devis
      // envoyé, en négociation) si un RDV de suivi a lieu plus tard dans le
      // cycle.
      if (!prospect.deal_stage) {
        prospectUpdate.deal_stage = 'rdv_fait';
      }
      prospectUpdate.deal_stage_updated_at = now;
    }

    await supabaseAdmin.from('prospects').update(prospectUpdate).eq('id', prospect.id);
  }

  return { note };
}
