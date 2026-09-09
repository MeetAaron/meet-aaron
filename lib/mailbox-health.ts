// lib/mailbox-health.ts
//
// PANNE SILENCIEUSE d'une boîte mail connectée (09/09/2026).
//
// Le connecteur « Autre boîte mail » (IMAP/SMTP, lib/imap.ts) n'a pas de
// jeton : si le commercial change le mot de passe de sa messagerie, ou si son
// hébergeur le révoque, le serveur répond « authentification refusée » et
// Aaron s'arrête — sans que personne ne le sache. Avec Google/Microsoft, un
// jeton révoqué finit par se voir (le rafraîchissement échoue et l'écran de
// connexion revient) ; ici, rien du tout. Un client peut croire qu'Aaron
// prospecte alors qu'il est muet depuis trois jours.
//
// Mécanique (colonnes de migration_mailbox_auth_health_2026-09-09.sql) :
//   - chaque échec d'AUTHENTIFICATION incrémente auth_failure_count ;
//   - à 3 échecs consécutifs, la boîte est déclarée en panne (auth_broken_at),
//     les envois sont mis en pause (voir MailboxAuthBrokenError dans
//     lib/messaging.ts) et le commercial reçoit UNE notification + UN email ;
//   - la première connexion réussie remet tout à zéro, en silence.
//
// Pourquoi 3 et pas 1 : un serveur IMAP répond parfois « refusé » lors d'une
// coupure ou d'une limitation temporaire (trop de connexions simultanées).
// Trois échecs d'affilée, sur des passages de cron espacés de 5 minutes, ne
// s'expliquent plus par un incident passager.
//
// Ne sont comptés QUE les échecs d'authentification : une panne réseau ou un
// serveur momentanément injoignable ne doit pas déclarer une boîte cassée
// (voir isAuthError).
//
// Best-effort de bout en bout : ces fonctions ne doivent jamais faire échouer
// l'opération qui les a appelées.

import { supabaseAdmin } from './supabase-admin';
import { sendPushNotification } from './push';
import { sendSystemEmail } from './google';

const FAILURES_BEFORE_BROKEN = 3;

// Vrai si l'erreur vient d'un refus d'identifiants, et non d'un incident
// réseau. Couvre les formulations d'imapflow/Dovecot/Exchange (IMAP) et de
// nodemailer/SMTP (codes 535 « authentication failed », 534, 454 4.7.0).
export function isAuthError(err: any): boolean {
  const text = String(err?.responseText || err?.response || err?.message || err || '');
  const code = String(err?.responseCode || err?.code || '');
  if (/^(535|534|530|538)$/.test(code)) return true;
  if (/EAUTH|AUTHENTICATIONFAILED|AUTHORIZATIONFAILED/i.test(code)) return true;
  return /authenticationfailed|authentication failed|invalid credentials|login failed|logindisabled|auth.{0,12}(failed|denied|refus)|535|incorrect (password|username)|mot de passe/i.test(text);
}

type Text = { subject: string; title: string; body: string };

// Ton : factuel et actionnable. On ne devine pas la cause (mot de passe
// changé, hébergeur, double authentification activée) — on dit ce qu'on
// observe, ce qui est en pause, et le geste unique qui répare. On précise
// que rien n'est perdu : c'est la première inquiétude d'un commercial.
const TEXTS: Record<string, Text> = {
  fr: {
    subject: 'Meet Aaron — ta boîte mail ne répond plus',
    title: 'Ta boîte mail ne répond plus',
    body: "Ta messagerie refuse ma connexion depuis plusieurs tentatives. En général, c'est que le mot de passe de ta boîte mail a changé (ou qu'il a été renouvelé par ton hébergeur).\n\nEn attendant, je mets tes envois en pause : rien n'est perdu, tout repartira automatiquement dès que la connexion sera rétablie. Je ne lis pas non plus les réponses de tes prospects pendant ce temps — jette un œil à ta boîte.\n\nPour réparer : ouvre Connexions dans Meet Aaron et saisis à nouveau le mot de passe de ta messagerie. Trente secondes.",
  },
  en: {
    subject: 'Meet Aaron — your mailbox is refusing my connection',
    title: 'Your mailbox is not responding',
    body: "Your mail server has refused my connection several times in a row. Usually this means your mailbox password has changed (or was renewed by your host).\n\nIn the meantime I have paused your sending: nothing is lost, everything resumes automatically once the connection works again. I am also not reading your prospects' replies during this time — do keep an eye on your inbox.\n\nTo fix it: open Connections in Meet Aaron and enter your mail password again. Thirty seconds.",
  },
  de: {
    subject: 'Meet Aaron — Ihr Postfach verweigert die Verbindung',
    title: 'Ihr Postfach antwortet nicht mehr',
    body: "Ihr Mailserver hat meine Verbindung mehrfach hintereinander abgelehnt. Meist bedeutet das, dass sich das Passwort Ihres Postfachs geändert hat (oder von Ihrem Anbieter erneuert wurde).\n\nSolange pausiere ich Ihre Sendungen: Es geht nichts verloren, alles läuft automatisch weiter, sobald die Verbindung wieder steht. Ich lese in dieser Zeit auch die Antworten Ihrer Interessenten nicht — behalten Sie Ihr Postfach im Blick.\n\nZur Behebung: Öffnen Sie „Verbindungen“ in Meet Aaron und geben Sie Ihr Mail-Passwort erneut ein. Dreißig Sekunden.",
  },
  it: {
    subject: 'Meet Aaron — la vostra casella rifiuta la connessione',
    title: 'La vostra casella non risponde più',
    body: "Il vostro server di posta ha rifiutato la mia connessione più volte di seguito. Di solito significa che la password della casella è cambiata (o è stata rinnovata dal vostro provider).\n\nNel frattempo metto in pausa i vostri invii: non si perde nulla, tutto riparte automaticamente appena la connessione torna. In questo periodo non leggo nemmeno le risposte dei vostri contatti — tenete d'occhio la casella.\n\nPer risolvere: aprite Connessioni in Meet Aaron e inserite di nuovo la password della posta. Trenta secondi.",
  },
  es: {
    subject: 'Meet Aaron — tu buzón rechaza mi conexión',
    title: 'Tu buzón ya no responde',
    body: "Tu servidor de correo ha rechazado mi conexión varias veces seguidas. Normalmente significa que la contraseña de tu buzón ha cambiado (o que tu proveedor la ha renovado).\n\nMientras tanto pauso tus envíos: no se pierde nada, todo se reanuda automáticamente en cuanto la conexión funcione. Tampoco leo las respuestas de tus posibles clientes durante este tiempo — echa un vistazo a tu buzón.\n\nPara solucionarlo: abre Conexiones en Meet Aaron e introduce de nuevo la contraseña de tu correo. Treinta segundos.",
  },
  pt: {
    subject: 'Meet Aaron — a sua caixa de correio recusa a ligação',
    title: 'A sua caixa de correio já não responde',
    body: "O seu servidor de correio recusou a minha ligação várias vezes seguidas. Normalmente significa que a palavra-passe da sua caixa mudou (ou foi renovada pelo seu alojamento).\n\nEntretanto, coloco os seus envios em pausa: nada se perde, tudo recomeça automaticamente assim que a ligação voltar. Também não leio as respostas dos seus potenciais clientes durante este período — vá vendo a sua caixa.\n\nPara resolver: abra Ligações no Meet Aaron e introduza novamente a palavra-passe do seu correio. Trinta segundos.",
  },
  nl: {
    subject: 'Meet Aaron — uw mailbox weigert de verbinding',
    title: 'Uw mailbox reageert niet meer',
    body: "Uw mailserver heeft mijn verbinding meerdere keren achter elkaar geweigerd. Meestal betekent dit dat het wachtwoord van uw mailbox is gewijzigd (of door uw provider is vernieuwd).\n\nIn de tussentijd pauzeer ik uw verzendingen: er gaat niets verloren, alles hervat automatisch zodra de verbinding weer werkt. Ik lees in deze periode ook de antwoorden van uw prospects niet — houd uw mailbox in de gaten.\n\nOplossen: open Verbindingen in Meet Aaron en voer opnieuw uw mailwachtwoord in. Dertig seconden.",
  },
};

// Un échec d'authentification de plus. Déclare la panne au 3e et prévient
// le commercial une seule fois.
export async function recordMailboxAuthFailure(userId: string, provider: string, detail?: string) {
  try {
    const { data: connection } = await supabaseAdmin
      .from('oauth_connections')
      .select('id, auth_failure_count, auth_broken_at, auth_broken_notified_at, provider_account_email')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (!connection) return;

    const count = ((connection as any).auth_failure_count || 0) + 1;
    const nowIso = new Date().toISOString();
    const becomesBroken = count >= FAILURES_BEFORE_BROKEN;

    const { error } = await supabaseAdmin
      .from('oauth_connections')
      .update({
        auth_failure_count: count,
        ...(becomesBroken && !(connection as any).auth_broken_at ? { auth_broken_at: nowIso } : {}),
      })
      .eq('id', (connection as any).id);
    // Colonnes absentes (migration pas encore passée) : on log et on continue,
    // la panne reste invisible mais rien ne casse.
    if (error) {
      if (error.code !== '42703') console.error('recordMailboxAuthFailure:', error.message);
      return;
    }

    console.error(
      `[Boîte mail] échec d'authentification ${count}/${FAILURES_BEFORE_BROKEN} pour ${(connection as any).provider_account_email} (${provider})` +
        (detail ? ` — ${String(detail).slice(0, 300)}` : '')
    );

    if (!becomesBroken || (connection as any).auth_broken_notified_at) return;

    // Marqué AVANT l'envoi : si la notification échoue, on n'inondera pas le
    // commercial au passage de cron suivant.
    await supabaseAdmin
      .from('oauth_connections')
      .update({ auth_broken_notified_at: nowIso })
      .eq('id', (connection as any).id);

    const { data: user } = await supabaseAdmin.from('users').select('id, email, locale').eq('id', userId).maybeSingle();
    const texts = TEXTS[(user as any)?.locale] || TEXTS.fr;
    await sendPushNotification(userId, {
      title: texts.title,
      body: texts.body.split('\n\n')[0],
      url: '/app/connexions',
    }).catch(() => {});
    // Email envoyé depuis la boîte de l'éditeur (aaron@meetaaron.app) et non
    // depuis celle du commercial — la sienne est justement injoignable.
    if ((user as any)?.email) {
      await sendSystemEmail((user as any).email, texts.subject, texts.body).catch(() => {});
    }
  } catch (err: any) {
    console.error('recordMailboxAuthFailure:', err?.message || err);
  }
}

// Connexion réussie : on efface tout, en silence (pas de « c'est réparé ! » —
// le commercial vient de ressaisir son mot de passe, il le sait).
export async function clearMailboxAuthFailures(userId: string, provider: string) {
  try {
    const { data: connection } = await supabaseAdmin
      .from('oauth_connections')
      .select('id, auth_failure_count, auth_broken_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (!connection) return;
    if (!(connection as any).auth_failure_count && !(connection as any).auth_broken_at) return;
    await supabaseAdmin
      .from('oauth_connections')
      .update({ auth_failure_count: 0, auth_broken_at: null, auth_broken_notified_at: null })
      .eq('id', (connection as any).id);
  } catch {
    // best-effort
  }
}

// Boîte déclarée en panne ? Lu avant chaque envoi (lib/messaging.ts) pour
// mettre les messages en attente au lieu de les perdre.
export async function isMailboxAuthBroken(userId: string, provider: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('oauth_connections')
      .select('auth_broken_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (error) return false; // colonne absente : on ne bloque rien
    return Boolean((data as any)?.auth_broken_at);
  } catch {
    return false;
  }
}
