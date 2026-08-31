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
import { localeInstruction, normalizeLocale } from './locale-instruction';

export type AppointmentOutcome = 'a_continuer' | 'opportunite' | 'devis' | 'perdu';

const OUTCOME_LABELS: Record<AppointmentOutcome, string> = {
  a_continuer: 'Bon rdv, à continuer',
  opportunite: 'Opportunité',
  devis: 'Demande de devis',
  perdu: 'Perdu',
};

const MOOD_LABELS: Record<string, string> = {
  bien: 'bien passé',
  moyen: 'moyennement passé',
  mal: 'mal passé',
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

// Ces notes sont un texte FIXE (pas généré par Claude, voir plus bas
// pourquoi) — donc pas de traduction automatique possible. Traduites à la
// main dans les 7 langues supportées (voir lib/locale-instruction.ts),
// même contenu que la version française d'origine dans chaque langue.
const FALLBACK_NOTES: Record<string, Record<AppointmentOutcome, string>> = {
  fr: {
    a_continuer: "Top, garde le momentum : une relance courte dans les prochains jours pour caler la suite peut faire la différence.",
    opportunite: "Félicitations ! C'est une nouvelle opportunité — le prospect vient d'être déplacé dans le tableau des Opportunités. Place à la vente, il doit désormais commander et devenir client !",
    devis: "Félicitations ! C'est une nouvelle opportunité — le prospect vient d'être déplacé dans le tableau des Opportunités, avec un devis en cours. Place à la vente, il doit désormais commander et devenir client !",
    perdu: "Dommage pour celui-là. Si tu as une minute, note pourquoi (prix, timing, concurrent...) — ça aide à mieux cibler les prochains.",
  },
  en: {
    a_continuer: "Nice, keep the momentum going: a quick follow-up in the next few days to lock in next steps can make all the difference.",
    opportunite: "Congrats! This is a new opportunity — the prospect has just been moved to the Opportunities board. Time to close the deal, they now need to order and become a customer!",
    devis: "Congrats! This is a new opportunity — the prospect has just been moved to the Opportunities board, with a quote in progress. Time to close the deal, they now need to order and become a customer!",
    perdu: "Too bad about that one. If you have a minute, note down why (price, timing, a competitor...) — it helps target the next ones better.",
  },
  de: {
    a_continuer: "Klasse, bleib dran: eine kurze Nachfass-Nachricht in den nächsten Tagen, um die nächsten Schritte festzuzurren, kann den Unterschied machen.",
    opportunite: "Glückwunsch! Das ist eine neue Chance — der Interessent wurde gerade in die Chancen-Übersicht verschoben. Jetzt geht's an den Abschluss, er muss jetzt bestellen und Kunde werden!",
    devis: "Glückwunsch! Das ist eine neue Chance — der Interessent wurde gerade in die Chancen-Übersicht verschoben, mit einem laufenden Angebot. Jetzt geht's an den Abschluss, er muss jetzt bestellen und Kunde werden!",
    perdu: "Schade um den. Wenn du kurz Zeit hast, notiere warum (Preis, Timing, Wettbewerber...) — das hilft, die nächsten besser zu treffen.",
  },
  it: {
    a_continuer: "Ottimo, mantieni lo slancio: un breve follow-up nei prossimi giorni per definire i prossimi passi può fare la differenza.",
    opportunite: "Complimenti! È una nuova opportunità — il prospect è appena stato spostato nella tabella Opportunità. Ora si tratta di vendere, deve ordinare e diventare cliente!",
    devis: "Complimenti! È una nuova opportunità — il prospect è appena stato spostato nella tabella Opportunità, con un preventivo in corso. Ora si tratta di vendere, deve ordinare e diventare cliente!",
    perdu: "Peccato per questo. Se hai un minuto, annota il motivo (prezzo, tempistica, concorrente...) — aiuta a mirare meglio i prossimi.",
  },
  es: {
    a_continuer: "Genial, mantén el impulso: un seguimiento breve en los próximos días para cerrar los siguientes pasos puede marcar la diferencia.",
    opportunite: "¡Felicidades! Es una nueva oportunidad — el prospecto acaba de trasladarse al tablero de Oportunidades. Ahora toca vender, ¡tiene que pedir y convertirse en cliente!",
    devis: "¡Felicidades! Es una nueva oportunidad — el prospecto acaba de trasladarse al tablero de Oportunidades, con un presupuesto en curso. Ahora toca vender, ¡tiene que pedir y convertirse en cliente!",
    perdu: "Lástima con ese. Si tienes un minuto, anota por qué (precio, momento, competidor...) — ayuda a apuntar mejor a los próximos.",
  },
  pt: {
    a_continuer: "Ótimo, mantenha o ritmo: um follow-up rápido nos próximos dias para definir os próximos passos pode fazer a diferença.",
    opportunite: "Parabéns! É uma nova oportunidade — o prospect acabou de ser movido para o quadro de Oportunidades. Agora é vender, ele precisa encomendar e se tornar cliente!",
    devis: "Parabéns! É uma nova oportunidade — o prospect acabou de ser movido para o quadro de Oportunidades, com um orçamento em andamento. Agora é vender, ele precisa encomendar e se tornar cliente!",
    perdu: "Pena por esse. Se tiver um minuto, anote o motivo (preço, timing, concorrente...) — ajuda a mirar melhor os próximos.",
  },
  nl: {
    a_continuer: "Mooi, hou het momentum vast: een korte follow-up in de komende dagen om de vervolgstappen vast te leggen kan het verschil maken.",
    opportunite: "Gefeliciteerd! Dit is een nieuwe kans — de prospect is zojuist verplaatst naar het Kansen-bord. Tijd om te verkopen, hij moet nu bestellen en klant worden!",
    devis: "Gefeliciteerd! Dit is een nieuwe kans — de prospect is zojuist verplaatst naar het Kansen-bord, met een offerte in behandeling. Tijd om te verkopen, hij moet nu bestellen en klant worden!",
    perdu: "Jammer van deze. Als je een minuutje hebt, noteer waarom (prijs, timing, concurrent...) — dat helpt om de volgende beter te richten.",
  },
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

// Docx Modifs Aaron 30/08/2026, items 3 et 7 : en plus de l'issue (outcome),
// le commercial peut dire COMMENT ça s'est passé (mood : bien / moyen / mal)
// et ajouter du contexte libre ou par chips ("points communs sur les
// abeilles", "je lui envoie le devis dans la journée"...). Les deux
// nourrissent la réaction d'Aaron et, si demandé, l'email de remerciement
// (voir sendThankYouEmail plus bas). Colonnes outcome_mood / outcome_context :
// migration_appointment_brief_2026-08-31.sql.
export type AppointmentMood = 'bien' | 'moyen' | 'mal';

export interface OutcomeDetails {
  mood?: AppointmentMood | null;
  context?: string | null;
}

export async function recordAppointmentOutcome(
  appointmentId: string,
  outcome: AppointmentOutcome,
  details: OutcomeDetails = {}
) {
  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, prospect_id, prospects(id, full_name, company_id, deal_stage, users(locale))')
    .eq('id', appointmentId)
    .single();

  if (error || !appointment) {
    throw new Error('RDV introuvable');
  }

  const prospect = (appointment as any).prospects;
  const companyId = prospect?.company_id || null;
  const locale = normalizeLocale(prospect?.users?.locale);

  let note = FALLBACK_NOTES[locale][outcome];

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
          model: 'claude-haiku-4-5',
          max_tokens: 150,
          messages: [
            {
              role: 'user',
              content:
                `Tu es Aaron, copilote commercial IA. Le commercial vient de te dire qu'un RDV avec le prospect ` +
                `"${prospect?.full_name || 'un prospect'}" s'est soldé par : "${OUTCOME_LABELS[outcome]}".\n` +
                (details.mood ? `Son ressenti sur le RDV : ${MOOD_LABELS[details.mood]}.\n` : '') +
                (details.context?.trim() ? `Contexte donné par le commercial : "${details.context.trim().slice(0, 600)}".\n` : '') +
                `Réagis en 1 à 2 phrases maximum, ton chaleureux et direct, avec un conseil concret pour la suite. ` +
                `Réponds uniquement avec ce message, ${localeInstruction(locale)}, sans préambule ni titre.`,
            },
          ],
        },
        companyId, 'as'
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

  const outcomeUpdate: Record<string, any> = { outcome, outcome_note: note, outcome_recorded_at: new Date().toISOString() };
  if (details.mood) outcomeUpdate.outcome_mood = details.mood;
  if (details.context?.trim()) outcomeUpdate.outcome_context = details.context.trim().slice(0, 2000);
  let { error: updateError } = await supabaseAdmin.from('appointments').update(outcomeUpdate).eq('id', appointmentId);
  if (updateError && updateError.code === '42703') {
    // Migration migration_appointment_brief_2026-08-31.sql pas encore passée :
    // on enregistre au moins l'issue et la note, comme avant.
    ({ error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({ outcome, outcome_note: note, outcome_recorded_at: outcomeUpdate.outcome_recorded_at })
      .eq('id', appointmentId));
  }

  if (prospect?.id) {
    const now = new Date().toISOString();
    const prospectUpdate: Record<string, any> = { status: OUTCOME_TO_PROSPECT_STATUS[outcome], status_updated_at: now };

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


// Item 7 (docx 30/08) : "Comment s'est passé le RDV ? Je renverrai un email
// de remerciement." Aaron rédige un court email de remerciement au prospect,
// à partir du ressenti/contexte donné par le commercial (ex. "points communs
// sur les abeilles", "je lui envoie le devis dans la journée"), et l'envoie
// depuis la boîte du commercial. Journalisé dans la conversation du prospect
// (visible dans « Conversation »). Best-effort : renvoie false si rien n'a
// été envoyé (pas d'email, plafond API, boîte non connectée...).
export async function sendThankYouEmail(
  appointmentId: string,
  outcome: AppointmentOutcome,
  details: OutcomeDetails = {}
): Promise<{ sent: boolean; error?: string }> {
  const { data: appointment } = await supabaseAdmin
    .from('appointments')
    .select('id, proposed_at, type, prospect_id, prospects(id, full_name, email, company_id, assigned_user_id, users(id, full_name, first_name, locale, email))')
    .eq('id', appointmentId)
    .single();
  const prospect = (appointment as any)?.prospects;
  const seller = prospect?.users;
  if (!appointment || !prospect?.email || !seller?.id) return { sent: false, error: 'prospect sans email' };

  const locale = normalizeLocale(seller.locale);
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('name, business_summary')
    .eq('id', prospect.company_id)
    .maybeSingle();

  const mentionsQuote = /devis|proposition|contrat|abonnement|tarif|quote|offer/i.test(details.context || '') || outcome === 'devis';

  let subject = '';
  let body = '';
  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, l'assistant commercial de ${seller.first_name || seller.full_name || 'un commercial'}` +
              `${company?.name ? ` (société ${company.name})` : ''}. ` +
              `Un rendez-vous ${appointment.type ? `(${appointment.type}) ` : ''}vient d'avoir lieu avec le prospect "${prospect.full_name || ''}".\n` +
              `Issue du RDV selon le commercial : "${OUTCOME_LABELS[outcome]}".\n` +
              (details.mood ? `Ressenti du commercial : ${MOOD_LABELS[details.mood]}.\n` : '') +
              (details.context?.trim() ? `Contexte donné par le commercial : "${details.context.trim().slice(0, 800)}".\n` : '') +
              (company?.business_summary ? `Ce que vend la société (extrait) : ${company.business_summary.slice(0, 600)}\n` : '') +
              `Rédige l'email de remerciement que le commercial enverra LUI-MÊME au prospect, à la première personne (je), ` +
              `court (4 à 7 phrases), chaleureux et naturel, sans flatterie excessive, en reprenant 1 élément concret du contexte s'il y en a un ` +
              `(un point commun personnel, un sujet abordé), et en confirmant la suite convenue` +
              (mentionsQuote ? ` (le devis/la proposition sera envoyé(e) comme promis)` : '') +
              `. Pas de formule "en tant qu'IA", pas de signature (elle est ajoutée automatiquement), pas de titre. ` +
              `Réponds STRICTEMENT au format JSON : {"subject": "...", "body": "..."} ${localeInstruction(locale)}.`,
          },
        ],
      },
      prospect.company_id, 'as'
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    const raw = (textBlock?.text || '').trim();
    const jsonText = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText);
    subject = String(parsed.subject || '').trim();
    body = String(parsed.body || '').trim();
  } catch (err: any) {
    if (!(err instanceof MonthlyCapExceededError)) {
      console.error('Erreur rédaction email de remerciement post-RDV:', err?.message || err);
    }
    return { sent: false, error: 'rédaction impossible' };
  }
  if (!subject || !body) return { sent: false, error: 'email vide' };

  try {
    // Import dynamique pour ne pas créer de cycle lib/messaging ↔ lib/anthropic-client.
    const { sendEmailForUser } = await import('./messaging');
    await sendEmailForUser(seller.id, prospect.email, subject, body, { emailType: 'transactional' });
  } catch (err: any) {
    console.error('Erreur envoi email de remerciement post-RDV:', err?.message || err);
    return { sent: false, error: err?.message || 'envoi impossible' };
  }

  // Journalise dans la conversation email du prospect (visible dans « Conversation »).
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('prospect_id', prospect.id)
    .eq('channel', 'email')
    .maybeSingle();
  if (conversation) {
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      sender_email: seller.email || '',
      recipient_email: prospect.email,
      body: `${subject}\n\n${body}`,
    });
  }

  await supabaseAdmin
    .from('appointments')
    .update({ thank_you_sent_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .then(() => {}, () => {});

  return { sent: true };
}
