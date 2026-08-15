// lib/appointment-outcome.ts
// Enregistre le bilan d'un RDV une fois que le commercial a répondu à la
// question d'Aaron ("comment ça s'est passé ?"), et fait réagir Aaron :
// courte note d'encouragement/conseil + mise à jour du statut du prospect.
//
// Aaron Sales (2026-08-13) : ce bilan est aussi le déclencheur de la mise à
// jour AUTOMATIQUE du pipeline de vente (prospects.deal_stage), sans
// ressaisie manuelle du commercial — voir migration_aaron_sales_2026-08-13.sql
// et app/app/sales/page.jsx.
//
// CHANGEMENTS A FAIRE #6 (2026-08-15) : les 4 choix proposés au commercial ont
// été revus. Avant : client / bien_passe / moyen / perdu (avec "client" =
// signature immédiate). Maintenant : a_continuer / opportunite / devis / perdu.
// "opportunite" et "demande de devis" déclenchent la MÊME réaction d'Aaron
// (félicitations, prospect déplacé dans le tableau des Opportunités — voir
// app/app/sales/page.jsx / VALID_DEAL_STAGES dans app/api/prospects/[id]/route.ts) ;
// la signature immédiate ("client") n'est plus un choix du bilan — une fois
// l'opportunité créée, le passage à "Signé" se fait depuis la page Opportunités
// (action "set_deal_stage"), qui déclenche déjà is_won/first_order_confirmed_at.

import { supabaseAdmin } from './supabase-admin';
import { callClaude, MonthlyCapExceededError } from './anthropic-client';

export type AppointmentOutcome = 'a_continuer' | 'opportunite' | 'devis' | 'perdu';

const OUTCOME_LABELS: Record<AppointmentOutcome, string> = {
  a_continuer: 'Bon rdv, à continuer',
  opportunite: 'Opportunité',
  devis: 'Demande de devis',
  perdu: 'Perdu',
};

// Statut du prospect (voir la légende dans app/app/prospects/page.jsx :
// vert = en bonne voie, jaune = en cours, orange = risque de perdre,
// rouge = perdu, bleu = RDV obtenu/opportunité). Une opportunité ou une
// demande de devis fait basculer le prospect en 'bleu', au même titre qu'un
// RDV tout juste validé — c'est désormais un prospect "actif dans le pipeline
// des opportunités", suivi depuis la page Opportunités plutôt que Prospects.
const OUTCOME_TO_PROSPECT_STATUS: Record<AppointmentOutcome, string> = {
  a_continuer: 'vert',
  opportunite: 'bleu',
  devis: 'bleu',
  perdu: 'rouge',
};

const FALLBACK_NOTES: Record<AppointmentOutcome, string> = {
  a_continuer: "Top, garde le momentum : une relance courte dans les prochains jours pour caler la suite peut faire la différence.",
  opportunite: "Félicitations ! C'est une nouvelle opportunité — le prospect vient d'être déplacé dans le tableau des Opportunités. Place à la vente, il doit désormais commander et devenir client !",
  devis: "Félicitations ! C'est une nouvelle opportunité — le prospect vient d'être déplacé dans le tableau des Opportunités, avec un devis en cours. Place à la vente, il doit désormais commander et devenir client !",
  perdu: "Dommage pour celui-là. Si tu as une minute, note pourquoi (prix, timing, concurrent...) — ça aide à mieux cibler les prochains.",
};

// Ordre des étapes du pipeline (voir STAGE_ORDER dans app/app/sales/page.jsx)
// — sert à ne jamais faire reculer une affaire déjà plus avancée quand le
// bilan d'un nouveau RDV (ex: RDV de suivi) est enregistré.
const STAGE_RANK: Record<string, number> = {
  rdv_fait: 0,
  devis_envoye: 1,
  en_negociation: 2,
  signe: 3,
  perdu: -1,
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

  // Pour "opportunite" / "devis", le message doit garantir un contenu précis
  // (féliciter + confirmer le déplacement dans le tableau des Opportunités —
  // voir CHANGEMENTS A FAIRE #6) : on utilise directement le texte fixe plutôt
  // que de laisser Claude reformuler et risquer de perdre cette information.
  // Pour les 2 autres issues, la note personnalisée d'Aaron reste un "bonus" —
  // si le plafond API est atteint ou que l'appel échoue, on retombe
  // silencieusement sur la note générique plutôt que de bloquer l'enregistrement
  // du bilan (l'essentiel : le statut du prospect est à jour).
  if (outcome !== 'opportunite' && outcome !== 'devis') {
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
  }

  await supabaseAdmin
    .from('appointments')
    .update({ outcome, outcome_note: note, outcome_recorded_at: new Date().toISOString() })
    .eq('id', appointmentId);

  if (prospect?.id) {
    const now = new Date().toISOString();
    const prospectUpdate: Record<string, any> = { status: OUTCOME_TO_PROSPECT_STATUS[outcome] };

    if (outcome === 'opportunite' || outcome === 'devis') {
      // Nouvelle opportunité (ou demande de devis) : déplace le prospect dans
      // le tableau des Opportunités (app/app/sales/page.jsx, alimenté par tout
      // prospect avec deal_stage renseigné — voir app/api/sales/pipeline).
      // "devis" démarre directement à l'étape "devis envoyé" (plus avancée
      // qu'un simple "rdv_fait"), "opportunite" à l'étape de départ — sans
      // jamais faire reculer une affaire déjà plus avancée (ex: RDV de suivi
      // sur une négociation en cours).
      const targetStage = outcome === 'devis' ? 'devis_envoye' : 'rdv_fait';
      const currentRank = prospect.deal_stage ? STAGE_RANK[prospect.deal_stage] ?? -1 : -1;
      if (currentRank < STAGE_RANK[targetStage]) {
        prospectUpdate.deal_stage = targetStage;
        prospectUpdate.deal_stage_updated_at = now;
      }
    } else if (outcome === 'perdu') {
      prospectUpdate.deal_stage = 'perdu';
      prospectUpdate.deal_stage_updated_at = now;
      prospectUpdate.is_lost = true;
      prospectUpdate.lost_at = now;
    }
    // "a_continuer" : bon RDV mais pas encore une opportunité formelle — on ne
    // touche pas au deal_stage, le prospect reste suivi depuis la page Prospects.

    await supabaseAdmin.from('prospects').update(prospectUpdate).eq('id', prospect.id);
  }

  return { note };
}
