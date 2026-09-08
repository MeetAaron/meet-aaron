// lib/prospect-handover.ts
//
// PASSAGE DE RELAIS quand un prospect devient client (demande Alex,
// 07/09/2026 : « dès que le statut client est atteint, Aaron envoie le
// message de félicitations et il passe la main à l'utilisateur. Donc le
// contact passera automatiquement en "géré par moi" »).
//
// Pourquoi ça manquait : `ai_managed` existe depuis le 17/08 mais n'était
// basculé qu'À LA MAIN, par le bouton « Aaron s'en charge » de la fiche
// contact. Un prospect gagné restait donc affiché « Aaron s'en charge »
// indéfiniment, alors qu'en réalité check-inbox ne répond déjà plus
// automatiquement à un client (voir handleWonCustomerMessage). L'affichage
// mentait au commercial : il pouvait croire qu'Aaron gérait son nouveau
// client, et ne rien faire.
//
// L'EXCEPTION qui justifie ce fichier plutôt qu'une ligne dans chaque route :
// les sociétés abonnées au module **Aaron Clients** (offer_ac_active) ont
// justement acheté le suivi client automatique — chez elles, Aaron continue
// (accueil, check-ins, renouvellements) et on ne passe PAS la main. La règle
// doit donc être écrite une seule fois, pas recopiée sur les quatre endroits
// où un prospect peut devenir client (bouton « Gagné », étape « Client » du
// pipeline, détection d'une commande dans un email, webhook externe).
//
// Best-effort de bout en bout : ce relais est un confort d'affichage et une
// notification. Une erreur ici ne doit jamais faire échouer la conversion en
// client elle-même, qui, elle, est comptable.

import { supabaseAdmin } from './supabase-admin';
import { sendPushNotification } from './push';

const HANDOVER_TEXTS: Record<string, { title: string; body: string }> = {
  fr: { title: 'Nouveau client — à toi de jouer', body: '{name} est officiellement client. Je lui ai envoyé le mot de félicitations et je passe la main : c\'est toi qui suis la relation à partir de maintenant.' },
  en: { title: 'New client — over to you', body: '{name} is officially a client. I sent the congratulations note and I\'m handing over: the relationship is yours from here.' },
  de: { title: 'Neuer Kunde — jetzt sind Sie dran', body: '{name} ist offiziell Kunde. Ich habe die Glückwünsche verschickt und übergebe: Die Beziehung liegt ab jetzt bei Ihnen.' },
  it: { title: 'Nuovo cliente — a te la palla', body: '{name} è ufficialmente cliente. Ho inviato le congratulazioni e passo la mano: da qui in poi la relazione è tua.' },
  es: { title: 'Nuevo cliente — te toca', body: '{name} ya es cliente oficialmente. He enviado la felicitación y te paso el relevo: a partir de ahora la relación es tuya.' },
  pt: { title: 'Novo cliente — agora é contigo', body: '{name} é oficialmente cliente. Enviei os parabéns e passo o testemunho: a relação é tua a partir de agora.' },
  nl: { title: 'Nieuwe klant — nu is het aan jou', body: '{name} is officieel klant. Ik heb de felicitaties gestuurd en draag over: de relatie is vanaf nu van jou.' },
};

// Variante pour les sociétés qui ont le module Aaron Clients : là, Aaron ne
// passe pas la main, il enchaîne — le commercial doit le savoir aussi.
const KEEP_TEXTS: Record<string, { title: string; body: string }> = {
  fr: { title: 'Nouveau client', body: '{name} est officiellement client. Je prends la suite : accueil, points de suivi et renouvellement.' },
  en: { title: 'New client', body: '{name} is officially a client. I\'m taking it from here: onboarding, check-ins and renewal.' },
  de: { title: 'Neuer Kunde', body: '{name} ist offiziell Kunde. Ich übernehme: Onboarding, Check-ins und Verlängerung.' },
  it: { title: 'Nuovo cliente', body: '{name} è ufficialmente cliente. Proseguo io: accoglienza, follow-up e rinnovo.' },
  es: { title: 'Nuevo cliente', body: '{name} ya es cliente oficialmente. Yo sigo: bienvenida, seguimiento y renovación.' },
  pt: { title: 'Novo cliente', body: '{name} é oficialmente cliente. Eu continuo: acolhimento, acompanhamento e renovação.' },
  nl: { title: 'Nieuwe klant', body: '{name} is officieel klant. Ik neem het over: onboarding, check-ins en verlenging.' },
};

// `notify: false` pour les chemins qui envoient DÉJÀ leur propre push de
// félicitations (email d'accord détecté par check-inbox, webhook de signature
// Youtrust) : on y fait le relais silencieusement pour ne pas notifier deux
// fois le même événement à la seconde près.
export async function handOverWonProspect(
  prospectId: string,
  options: { notify?: boolean } = {}
): Promise<void> {
  try {
    const { data: prospect } = await supabaseAdmin
      .from('prospects')
      .select('id, full_name, assigned_user_id, company_id, ai_managed, handed_over_at')
      .eq('id', prospectId)
      .maybeSingle();

    if (!prospect || !prospect.assigned_user_id) return;
    // Déjà passé en revue une fois : un prospect ne devient client qu'une
    // fois, et plusieurs chemins peuvent le marquer gagné (bouton + email
    // détecté, par exemple). On ne notifie donc pas deux fois.
    if (prospect.handed_over_at) return;

    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('offer_ac_active')
      .eq('id', prospect.company_id)
      .maybeSingle();

    // Module Aaron Clients actif : le suivi client automatique est justement
    // ce que la société paie. Aaron garde la main.
    const keepsAaron = company?.offer_ac_active === true;

    const patch: Record<string, any> = { handed_over_at: new Date().toISOString() };
    if (!keepsAaron) patch.ai_managed = false;
    await supabaseAdmin.from('prospects').update(patch).eq('id', prospectId);

    if (options.notify === false) return;

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('locale')
      .eq('id', prospect.assigned_user_id)
      .maybeSingle();

    const table = keepsAaron ? KEEP_TEXTS : HANDOVER_TEXTS;
    const texts = table[(user as any)?.locale] || table.fr;
    await sendPushNotification(prospect.assigned_user_id, {
      title: texts.title,
      body: texts.body.replace('{name}', prospect.full_name || ''),
      url: `/app/prospects?user_id=${prospect.assigned_user_id}`,
    });
  } catch (err: any) {
    console.error('handOverWonProspect:', prospectId, err?.message);
  }
}
