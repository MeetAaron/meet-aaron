// app/api/cron/retry-uncontacted-prospects/route.ts
// Filet de sécurité, exécuté périodiquement via Vercel Cron.
//
// Cas traité : un prospect est ajouté (manuellement via POST /api/prospects,
// ou trouvé par une campagne via lib/sourcing.ts) AVANT que le commercial
// concerné ait connecté sa boîte mail (Gmail/Outlook) dans "Connexions".
// L'envoi du tout premier message d'Aaron échoue alors silencieusement (le
// prospect est quand même créé, avec un avertissement renvoyé au frontend),
// et jusqu'ici RIEN ne retentait cet envoi ensuite — même une fois la boîte
// mail connectée, le prospect restait bloqué indéfiniment sans être démarché
// ni avoir sa fiche remplie par Aaron (personality_type/notes/advice ne sont
// renseignés qu'après un premier contact réussi).
//
// IMPORTANT (corrigé le 14/08) : la première version de ce cron détectait un
// prospect "jamais contacté" via `personality_type IS NULL`. C'est FAUX :
// Aaron ne détecte un profil de personnalité qu'après une RÉPONSE du
// prospect (voir lib/aaron_system_prompt.md, section DISC) — sur un premier
// message envoyé sans réponse, personality_type reste légitimement null.
// Résultat : ce cron retentait un "premier contact" toutes les 20 minutes
// pour un prospect déjà contacté avec succès mais qui n'avait pas encore
// répondu, générant un nouveau message à chaque passage (spam constaté :
// 3 emails en 40 minutes sur un même prospect). Le bon critère de "jamais
// contacté" est l'absence de tout message sortant dans sa conversation —
// c'est ce que ce cron vérifie désormais.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateAaronResponse } from '@/lib/aaron';
import { sendEmailForUser, hasReachedProspectingCap, DailySendCapExceededError } from '@/lib/messaging';
import { MonthlyCapExceededError } from '@/lib/anthropic-client';

// Plafond par commercial et par passage, pour ne jamais déclencher une rafale
// d'envois Gmail/Outlook d'un coup si beaucoup de prospects étaient restés
// bloqués (ex: boîte mail connectée après plusieurs jours d'ajouts manuels).
const MAX_PER_USER_PER_RUN = 5;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: candidateProspects, error } = await supabaseAdmin
    .from('prospects')
    .select('id, email, assigned_user_id, conversations(id, messages(id))')
    .eq('is_won', false)
    .eq('is_lost', false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Vraiment "jamais contacté" = aucun message (sortant ou entrant) dans
  // aucune de ses conversations — voir la note en tête de fichier sur
  // pourquoi personality_type seul n'est pas un critère fiable.
  const stuckProspects = (candidateProspects || []).filter((p: any) => {
    const totalMessages = (p.conversations || []).reduce(
      (sum: number, c: any) => sum + (c.messages?.length || 0),
      0
    );
    return totalMessages === 0;
  });

  if (stuckProspects.length === 0) {
    return NextResponse.json({ contacted: 0 });
  }

  // Ne retente que pour les commerciaux ayant désormais une boîte mail
  // connectée — sinon on retomberait sur le même échec qu'au moment de la
  // création du prospect, pour rien.
  const userIds = Array.from(new Set(stuckProspects.map((p) => p.assigned_user_id)));
  const { data: connections } = await supabaseAdmin
    .from('oauth_connections')
    .select('user_id')
    .in('user_id', userIds)
    .in('provider', ['google', 'microsoft']);

  const connectedUserIds = new Set((connections || []).map((c) => c.user_id));

  const perUserCount: Record<string, number> = {};
  // Cache mémoire (le temps de ce passage) pour ne vérifier le plafond quotidien
  // qu'une seule fois par commercial plutôt qu'à chaque prospect — voir
  // lib/messaging.ts. Évite aussi de dépenser un appel Claude pour un prospect
  // qui ne pourra de toute façon pas être contacté aujourd'hui.
  const cappedUsers = new Map<string, boolean>();
  let contacted = 0;

  for (const prospect of stuckProspects) {
    if (!connectedUserIds.has(prospect.assigned_user_id)) continue;

    if (!cappedUsers.has(prospect.assigned_user_id)) {
      cappedUsers.set(prospect.assigned_user_id, await hasReachedProspectingCap(prospect.assigned_user_id));
    }
    if (cappedUsers.get(prospect.assigned_user_id)) continue;

    perUserCount[prospect.assigned_user_id] = (perUserCount[prospect.assigned_user_id] || 0) + 1;
    if (perUserCount[prospect.assigned_user_id] > MAX_PER_USER_PER_RUN) continue;

    let conversationId = (prospect as any).conversations?.[0]?.id;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .insert({ prospect_id: prospect.id, channel: 'email' })
        .select('id')
        .single();
      conversationId = conv?.id;
    }
    if (!conversationId) continue;

    try {
      const aaronOutput = await generateAaronResponse(prospect.id);

      // Garde-fou : ne pas envoyer/archiver un email vide si Aaron n'a rien
      // proposé (voir même correctif dans check-inbox).
      const hasEmailToSend =
        aaronOutput.email_draft?.subject?.trim() && aaronOutput.email_draft?.body?.trim();

      if (hasEmailToSend) {
        await sendEmailForUser(
          prospect.assigned_user_id,
          prospect.email,
          aaronOutput.email_draft.subject,
          aaronOutput.email_draft.body,
          { emailType: 'prospecting' }
        );

        const { data: senderUser } = await supabaseAdmin
          .from('users')
          .select('email')
          .eq('id', prospect.assigned_user_id)
          .single();

        await supabaseAdmin.from('messages').insert({
          conversation_id: conversationId,
          direction: 'outbound',
          sender_email: senderUser?.email || '',
          recipient_email: prospect.email,
          body: aaronOutput.email_draft.body,
        });
      }

      await supabaseAdmin
        .from('prospects')
        .update({
          status: aaronOutput.prospect_status,
          status_updated_at: new Date().toISOString(),
          personality_type: aaronOutput.personality_type,
          personality_notes: aaronOutput.personality_notes,
          aaron_advice: aaronOutput.aaron_advice,
          ...(aaronOutput.detected_phone ? { phone: aaronOutput.detected_phone } : {}),
        })
        .eq('id', prospect.id);

      contacted++;
    } catch (err: any) {
      if (!(err instanceof MonthlyCapExceededError) && !(err instanceof DailySendCapExceededError)) {
        console.error(`Erreur relance premier contact pour prospect ${prospect.id}:`, err.message);
      }
    }
  }

  return NextResponse.json({ contacted });
}
