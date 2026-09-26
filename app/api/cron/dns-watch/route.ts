// app/api/cron/dns-watch/route.ts
//
// AARON SURVEILLE LE DNS A LA PLACE DU COMMERCIAL, TOUS LES JOURS.
//
// Demande d'Alex (A_FAIRE.docx, 26/09/2026) : « Il faut faire le plus
// automatique possible. » Le reglage SPF/DKIM/DMARC est le seul point de
// l'application qui demande a l'utilisateur d'aller faire quelque chose
// ailleurs que dans Aaron — c'est donc celui ou il faut en demander le moins
// possible, et surtout ne jamais compter sur lui pour revenir dire que c'est
// fait.
//
// Ce cron ferme la boucle, dans les deux sens :
//
//   1. UN DOMAINE INCOMPLET recoit l'email pas-a-pas de
//      lib/dns-setup-email.ts — une seule fois par connexion. Cela couvre
//      aussi tous les comptes connectes AVANT que cette fonctionnalite
//      existe, qui n'auraient jamais rien recu autrement.
//
//   2. UN DOMAINE REPARE declenche une confirmation, et seulement alors :
//      « c'est en place, je reprends la prospection ». C'est la moitie qui
//      manque partout ailleurs — on previent les gens d'un probleme, jamais
//      de sa resolution, et ils restent persuades qu'il traine encore.
//      Le drapeau est remis a zero au passage, pour qu'une regression future
//      (domaine transfere, zone DNS reinitialisee) redeclenche tout le
//      processus sans intervention.
//
// Volontairement sans appel a Claude : que du DNS et de l'email, donc aucun
// cout API et aucun plafond a surveiller.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeDnsSetupNeeds, buildDnsSetupEmail } from '@/lib/dns-setup-email';
// `import type` obligatoire : avec isolatedModules (tsconfig.json), SWC
// compile chaque fichier isolement et ne peut pas savoir qu'un nom est un
// type — importe comme une valeur, il resterait dans le JS genere et
// provoquerait une erreur d'export au demarrage.
import type { MailProvider } from '@/lib/dns-setup-email';
import { sendEmailForUser } from '@/lib/messaging';
import { sendPushNotification } from '@/lib/push';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// Confirmation courte, dans les 7 langues. Volontairement en dur ici plutot
// que dans lib/dns-setup-email.ts : ce n'est pas le meme email et il ne doit
// jamais grossir — trois lignes, une bonne nouvelle, on passe a autre chose.
const FIXED_MESSAGE: Record<string, (domain: string) => { subject: string; body: string }> = {
  fr: (d) => ({
    subject: `C'est bon, ${d} est correctement configure`,
    body:
      `Bonne nouvelle : ${d} est maintenant correctement configure. Tes emails partent avec toutes les garanties que les messageries attendent.\n\n` +
      `Je reprends la prospection normalement. Tu n'as rien a faire.\n\nAaron\nTon assistant commercial`,
  }),
  en: (d) => ({
    subject: `All set — ${d} is correctly configured`,
    body:
      `Good news: ${d} is now correctly configured. Your emails go out with everything mail providers expect to see.\n\n` +
      `I am resuming prospecting as normal. Nothing for you to do.\n\nAaron\nYour sales assistant`,
  }),
  de: (d) => ({
    subject: `Alles bereit — ${d} ist korrekt konfiguriert`,
    body:
      `Gute Nachricht: ${d} ist jetzt korrekt konfiguriert. Ihre E-Mails gehen mit allem raus, was Mailanbieter erwarten.\n\n` +
      `Ich nehme die Akquise wie gewohnt wieder auf. Fuer Sie ist nichts zu tun.\n\nAaron\nIhr Vertriebsassistent`,
  }),
  it: (d) => ({
    subject: `Tutto pronto — ${d} e configurato correttamente`,
    body:
      `Buona notizia: ${d} e ora configurato correttamente. Le tue email partono con tutto cio che i provider di posta si aspettano.\n\n` +
      `Riprendo la prospezione normalmente. Non devi fare nulla.\n\nAaron\nIl tuo assistente commerciale`,
  }),
  es: (d) => ({
    subject: `Listo — ${d} esta correctamente configurado`,
    body:
      `Buena noticia: ${d} ya esta correctamente configurado. Tus correos salen con todo lo que los proveedores de correo esperan ver.\n\n` +
      `Retomo la prospeccion con normalidad. No tienes que hacer nada.\n\nAaron\nTu asistente comercial`,
  }),
  pt: (d) => ({
    subject: `Esta tudo pronto — ${d} esta corretamente configurado`,
    body:
      `Boa noticia: ${d} esta agora corretamente configurado. Os seus emails saem com tudo o que os fornecedores de email esperam.\n\n` +
      `Retomo a prospecao normalmente. Nao tem de fazer nada.\n\nAaron\nO seu assistente comercial`,
  }),
  nl: (d) => ({
    subject: `Klaar — ${d} is correct geconfigureerd`,
    body:
      `Goed nieuws: ${d} is nu correct geconfigureerd. Uw e-mails gaan de deur uit met alles wat e-mailproviders verwachten.\n\n` +
      `Ik hervat de prospectie zoals gewoonlijk. U hoeft niets te doen.\n\nAaron\nUw verkoopassistent`,
  }),
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const results: any[] = [];

  // Repli 42703 : tant que migration_signature_multilingue_2026-09-26.sql
  // n'est pas passée, ce cron tourne en mode « premier envoi uniquement »
  // (sans mémoire), plutôt que de renvoyer une erreur tous les matins.
  let hasSentColumn = true;
  let connsRes: any = await supabaseAdmin
    .from('oauth_connections')
    .select('id, user_id, provider, provider_account_email, dns_setup_email_sent_at')
    .in('provider', ['google', 'microsoft', 'imap']);
  if (connsRes.error && connsRes.error.code === '42703') {
    hasSentColumn = false;
    connsRes = await supabaseAdmin
      .from('oauth_connections')
      .select('id, user_id, provider, provider_account_email')
      .in('provider', ['google', 'microsoft', 'imap']);
  }
  if (connsRes.error) {
    return NextResponse.json({ error: connsRes.error.message }, { status: 500 });
  }

  // Un seul passage par utilisateur : quelqu'un qui a connecté Gmail ET
  // Outlook ne doit pas recevoir deux emails le même matin.
  const seenUsers = new Set<string>();

  for (const conn of connsRes.data || []) {
    const userId = String(conn.user_id || '');
    const email = String(conn.provider_account_email || '');
    if (!userId || !email.includes('@') || seenUsers.has(userId)) continue;
    seenUsers.add(userId);

    try {
      const needs = await computeDnsSetupNeeds(email, conn.provider as MailProvider);
      const alreadyWarned = hasSentColumn && !!conn.dns_setup_email_sent_at;

      // ── Tout est en place ────────────────────────────────────────────────
      if (!needs) {
        if (!alreadyWarned) {
          results.push({ user_id: userId, status: 'ok' });
          continue;
        }
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('locale')
          .eq('id', userId)
          .maybeSingle();
        const locale = String((user as any)?.locale || 'fr');
        const domain = email.split('@')[1];
        const message = (FIXED_MESSAGE[locale] || FIXED_MESSAGE.fr)(domain);
        await sendEmailForUser(userId, email, message.subject, message.body, {
          emailType: 'transactional',
        });
        await sendPushNotification(userId, {
          title: message.subject,
          body: message.body.split('\n')[0],
          url: '/app/connexions',
        }).catch(() => {});
        // Drapeau remis à zéro : une régression future relancera tout le
        // processus toute seule.
        await supabaseAdmin
          .from('oauth_connections')
          .update({ dns_setup_email_sent_at: null, domain_health_ok: true })
          .eq('id', conn.id);
        results.push({ user_id: userId, status: 'fixed', domain });
        continue;
      }

      // ── Il manque encore quelque chose ───────────────────────────────────
      if (alreadyWarned) {
        // Déjà prévenu, et les instructions sont dans sa boîte : on ne
        // renvoie rien. Le harcèlement quotidien ferait désinstaller
        // l'application avant de faire créer l'enregistrement.
        results.push({ user_id: userId, status: 'pending', domain: needs.domain });
        continue;
      }

      const { data: user } = await supabaseAdmin
        .from('users')
        .select('full_name, locale')
        .eq('id', userId)
        .maybeSingle();
      const firstName = String((user as any)?.full_name || '').trim().split(/\s+/)[0] || '';
      const { subject, body } = buildDnsSetupEmail((user as any)?.locale, firstName, needs);

      await sendEmailForUser(userId, email, subject, body, { emailType: 'transactional' });
      if (hasSentColumn) {
        await supabaseAdmin
          .from('oauth_connections')
          .update({ dns_setup_email_sent_at: new Date().toISOString() })
          .eq('id', conn.id);
      }
      results.push({
        user_id: userId,
        status: 'instructions_sent',
        domain: needs.domain,
        missing: [
          needs.spfMissing ? 'spf' : null,
          needs.dkimMissing ? 'dkim' : null,
          needs.dmarcMissing ? 'dmarc' : null,
        ].filter(Boolean),
      });
    } catch (err: any) {
      // Une boîte cassée, un domaine injoignable : on note et on continue.
      // Un seul utilisateur en échec ne doit pas priver tous les autres de
      // leur vérification quotidienne.
      results.push({ user_id: userId, status: 'error', error: err.message });
    }
  }

  return NextResponse.json({ checked: results.length, results });
}
