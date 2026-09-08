// lib/hard-ceiling-alert.ts
//
// DISJONCTEUR — alerte quand une société atteint le plafond DUR d'API.
//
// Décision Alex (08/09/2026), après avoir posé la question « le plafond dur,
// est-ce qu'Aaron dit d'acheter un boost ? » : non. Un siège normal consomme
// ~9 $ sur une enveloppe de 21,5 $ ; le plafond dur est à 3,5 fois la
// consommation réelle. Un client qui l'atteint n'est pas un client qui
// travaille trop — c'est un bug, une boucle, ou un abus. Vendre quelque chose
// à quelqu'un dans cet état serait à la fois malhonnête et incompréhensible
// pour lui (« vous avez consommé trop d'intelligence artificielle » ne veut
// rien dire pour un commercial).
//
// Donc : ce n'est pas un paywall, c'est un disjoncteur. L'éditeur est prévenu
// pour aller regarder ; le commercial reçoit un message neutre qui ne
// l'accuse de rien et lui dit quoi faire en attendant.
//
// UNE SEULE FOIS par société et par mois : réutilise la table credit_alerts
// (migration_credit_alerts_2026-09-07.sql) avec un seuil sentinelle, plutôt
// qu'une table de plus. La contrainte unique (company_id, year_month,
// threshold) fait tout le travail — l'insertion échoue silencieusement au
// deuxième passage, et le contrôle de plafond est traversé à CHAQUE appel
// d'IA : sans ce garde-fou, un client bloqué recevrait des dizaines de
// notifications identiques dans la minute.
//
// Best-effort de bout en bout : cette fonction ne doit jamais faire échouer
// l'appel qui l'a déclenchée (elle est déjà appelée depuis un chemin d'erreur).

import { supabaseAdmin } from './supabase-admin';
import { sendPushNotification } from './push';
import { sendSystemEmail } from './google';

// Seuil sentinelle dans credit_alerts : les alertes de budget normales valent
// 0.7 et 0.9 (part de l'enveloppe consommée). 1.5 = le multiplicateur du
// plafond dur, donc aucune collision possible avec un seuil réel.
const HARD_CEILING_SENTINEL = 1.5;

// Adresse de l'éditeur. Variable d'environnement pour ne pas avoir à
// redéployer si elle change, avec un repli explicite.
const OPERATOR_EMAIL = process.env.OPERATOR_ALERT_EMAIL || 'aaron@meetaaron.app';

type Text = { subject: string; title: string; body: string };

// Ton : on ne dit pas au commercial qu'il a « trop consommé » — on ne le sait
// pas encore, et dans l'hypothèse la plus probable c'est nous qui avons un
// problème. On annonce une vérification, pas une sanction.
//
// La consigne « repasse le contact en "je reprends la main" » n'est pas
// décorative : tant qu'un contact reste marqué géré par Aaron, une réponse
// écrite à la main par le commercial depuis sa boîte mail n'est PAS vue par
// Aaron (seuls les messages entrants du prospect sont enregistrés). Sans ce
// geste, Aaron reprendrait la conversation là où il croit l'avoir laissée, en
// ignorant ce que le commercial a répondu entre-temps.
const TEXTS: Record<string, Text> = {
  fr: {
    subject: 'Meet Aaron — je mets ta prospection en pause',
    title: 'Prospection en pause',
    body: "J'ai détecté un comportement inhabituel sur ton compte et je préfère m'arrêter le temps de le vérifier de notre côté. Ce n'est pas une limite que tu aurais dépassée : c'est très probablement un incident technique chez nous, et on revient vers toi rapidement.\n\nEn attendant, tes conversations en cours ne sont pas perdues : tu peux répondre toi-même à tes contacts depuis ta boîte mail. Un conseil pour éviter les doublons — sur la fiche des contacts auxquels tu réponds à la main, bascule « je reprends la main » : sinon je risque de reprendre la conversation sans savoir ce que tu leur as écrit.\n\nDésolé pour la gêne.",
  },
  en: {
    subject: 'Meet Aaron — pausing your prospecting',
    title: 'Prospecting paused',
    body: "I've spotted unusual behaviour on your account and I'd rather stop while we check it on our side. This is not a limit you exceeded: it is most likely a technical issue on our end, and we'll get back to you shortly.\n\nIn the meantime your live conversations are not lost: you can reply to your contacts yourself from your mailbox. One tip to avoid duplicates — on the contacts you answer by hand, switch the card to \"I'll take over\": otherwise I may pick the conversation back up without knowing what you wrote to them.\n\nSorry for the disruption.",
  },
  de: {
    subject: 'Meet Aaron — ich pausiere Ihre Akquise',
    title: 'Akquise pausiert',
    body: "Ich habe ein ungewöhnliches Verhalten auf Ihrem Konto festgestellt und halte lieber an, solange wir das auf unserer Seite prüfen. Es ist keine Grenze, die Sie überschritten hätten: Höchstwahrscheinlich liegt ein technisches Problem bei uns vor, und wir melden uns zeitnah.\n\nIhre laufenden Konversationen sind derweil nicht verloren: Sie können Ihren Kontakten selbst aus Ihrem Postfach antworten. Ein Hinweis gegen Dopplungen — setzen Sie bei den Kontakten, denen Sie von Hand antworten, die Karte auf „Ich übernehme\": sonst nehme ich das Gespräch womöglich wieder auf, ohne zu wissen, was Sie geschrieben haben.\n\nEntschuldigen Sie die Störung.",
  },
  it: {
    subject: 'Meet Aaron — metto in pausa la tua prospezione',
    title: 'Prospezione in pausa',
    body: "Ho rilevato un comportamento insolito sul tuo account e preferisco fermarmi il tempo di verificarlo dalla nostra parte. Non è un limite che avresti superato: molto probabilmente è un problema tecnico da noi, e torniamo da te a breve.\n\nNel frattempo le tue conversazioni in corso non sono perse: puoi rispondere tu stesso ai tuoi contatti dalla tua casella di posta. Un consiglio per evitare doppioni — sulla scheda dei contatti a cui rispondi a mano, passa a « riprendo io »: altrimenti rischio di riprendere la conversazione senza sapere cosa hai scritto.\n\nScusa per il disagio.",
  },
  es: {
    subject: 'Meet Aaron — pauso tu prospección',
    title: 'Prospección en pausa',
    body: "He detectado un comportamiento inusual en tu cuenta y prefiero parar mientras lo verificamos por nuestro lado. No es un límite que hayas superado: lo más probable es que sea una incidencia técnica nuestra, y volvemos contigo enseguida.\n\nMientras tanto, tus conversaciones en curso no se pierden: puedes responder tú mismo a tus contactos desde tu buzón. Un consejo para evitar duplicados — en la ficha de los contactos a los que respondas a mano, cambia a «me encargo yo»: si no, podría retomar la conversación sin saber qué les has escrito.\n\nDisculpa las molestias.",
  },
  pt: {
    subject: 'Meet Aaron — vou pausar a sua prospeção',
    title: 'Prospeção em pausa',
    body: "Detetei um comportamento invulgar na sua conta e prefiro parar enquanto verificamos do nosso lado. Não é um limite que tenha ultrapassado: muito provavelmente é um incidente técnico nosso, e voltamos a contactá-lo em breve.\n\nEntretanto as suas conversas em curso não se perdem: pode responder você mesmo aos seus contactos a partir da sua caixa de correio. Uma sugestão para evitar duplicações — na ficha dos contactos a que responder à mão, mude para «eu trato disto»: caso contrário posso retomar a conversa sem saber o que lhes escreveu.\n\nDesculpe o incómodo.",
  },
  nl: {
    subject: 'Meet Aaron — ik pauzeer uw acquisitie',
    title: 'Acquisitie gepauzeerd',
    body: "Ik heb ongebruikelijk gedrag op uw account vastgesteld en stop liever zolang wij dit aan onze kant nakijken. Het is geen limiet die u zou hebben overschreden: het gaat hoogstwaarschijnlijk om een technisch probleem bij ons, en wij komen snel bij u terug.\n\nUw lopende gesprekken gaan intussen niet verloren: u kunt uw contacten zelf vanuit uw mailbox beantwoorden. Eén tip tegen dubbel werk — zet bij de contacten die u met de hand beantwoordt de fiche op „ik neem het over\": anders pak ik het gesprek mogelijk weer op zonder te weten wat u hebt geschreven.\n\nExcuses voor het ongemak.",
  },
};

export async function notifyHardCeiling(companyId: string, spentUsd: number, ceilingUsd: number): Promise<void> {
  try {
    const yearMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    // Réservation atomique : la contrainte unique décide qui envoie. Si la
    // ligne existe déjà, c'est qu'un appel précédent a déjà prévenu ce
    // mois-ci — on sort sans rien envoyer.
    const { error: claimError } = await supabaseAdmin
      .from('credit_alerts')
      .insert({ company_id: companyId, year_month: yearMonth, threshold: HARD_CEILING_SENTINEL });
    if (claimError) return;

    const [{ data: company }, { data: users }] = await Promise.all([
      supabaseAdmin.from('companies').select('name').eq('id', companyId).maybeSingle(),
      supabaseAdmin.from('users').select('id, email, locale').eq('company_id', companyId),
    ]);

    // L'éditeur d'abord : c'est lui qui doit aller regarder, et son alerte ne
    // doit pas dépendre du succès des envois aux commerciaux.
    try {
      await sendSystemEmail(
        OPERATOR_EMAIL,
        `[Aaron] Plafond dur atteint — ${company?.name || companyId}`,
        `La société « ${company?.name || companyId} » (${companyId}) a atteint son plafond dur d'API.\n\n` +
          `Dépensé ce mois : ${spentUsd.toFixed(2)} $\n` +
          `Plafond dur : ${ceilingUsd.toFixed(2)} $\n` +
          `Comptes concernés : ${(users || []).length}\n\n` +
          `Toutes les fonctions d'IA sont arrêtées pour cette société jusqu'au mois prochain.\n` +
          `Un usage normal représente environ 9 $ par siège : ce niveau signale un bug, une boucle ou un abus, ` +
          `pas un mois chargé. À vérifier avant de relever quoi que ce soit.\n\n` +
          `Pour débloquer : relever companies.monthly_api_cap_usd (le plafond dur en découle), ` +
          `ou créditer un boost.`
      );
    } catch (err: any) {
      console.error('Alerte plafond dur à l\'éditeur:', err?.message);
    }

    for (const user of users || []) {
      const texts = TEXTS[(user as any).locale] || TEXTS.fr;
      // Push ET email : le commercial doit l'apprendre même s'il n'a pas
      // l'application ouverte, et surtout AVANT de se demander pourquoi
      // Aaron ne fait plus rien.
      await sendPushNotification((user as any).id, {
        title: texts.title,
        body: texts.body.split('\n\n')[0],
        url: '/app/dashboard',
      }).catch(() => {});
      if ((user as any).email) {
        await sendSystemEmail((user as any).email, texts.subject, texts.body).catch(() => {});
      }
    }
  } catch (err: any) {
    console.error('notifyHardCeiling:', companyId, err?.message);
  }
}
