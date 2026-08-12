// lib/appointment-outcome.ts
// Enregistre le bilan d'un RDV une fois que le commercial a répondu à la
// question d'Aaron ("comment ça s'est passé ?"), et fait réagir Aaron :
// courte note d'encouragement/conseil + mise à jour du statut du prospect.

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
    .select('id, prospect_id, prospects(id, full_name, company_id)')
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
    await supabaseAdmin
      .from('prospects')
      .update({ status: OUTCOME_TO_PROSPECT_STATUS[outcome] })
      .eq('id', prospect.id);
  }

  return { note };
}
