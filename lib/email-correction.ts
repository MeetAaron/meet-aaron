// lib/email-correction.ts
//
// RATTRAPER UN EMAIL DÉJÀ PARTI (demande Alex, 30/10/2026).
//
// Déclencheur : deux prospects réels ont reçu un message dont le corps entier
// était « Bon », puis « Bonjour Claire, je suis Axel ». La cause est corrigée
// (voir lib/extract-json.ts et max_tokens dans lib/aaron.ts), mais il
// n'existait AUCUN chemin de rattrapage : un commercial qui constate qu'un
// message est parti faux n'avait que deux options, ne rien faire ou ouvrir sa
// boîte et écrire à la main.
//
// Ce que ce module fait, et surtout ce qu'il refuse de faire.
//
// Il commence par JUGER si ça vaut un email. C'est tout l'intérêt par rapport
// à un bouton « renvoyer » : une coquille, un accent manquant, une virgule ne
// valent pas un second message — y revenir attire l'attention sur une faute
// que le prospect n'avait probablement pas vue, et brûle une touche pour
// rien. Un prix faux, un mauvais prénom, un message incompréhensible, un
// message envoyé à la mauvaise personne : là oui.
//
// Quand il rédige, trois règles tenues par le prompt : assumer en UNE phrase
// (trois lignes d'excuses transforment un incident en malaise), redonner
// l'information juste tout de suite (le but est de rattraper, pas de
// s'excuser), et répondre DANS LE FIL — un second email froid en vingt-quatre
// heures depuis une boîte jeune est précisément le signal de spam que la
// montée en charge cherche à éviter.
//
// RELECTURE TOUJOURS OBLIGATOIRE, sans réglage pour la désactiver. Envoyer
// automatiquement une excuse pour un message envoyé automatiquement, ce
// serait remettre une pièce dans la machine qui vient de se tromper.

import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';
import { extractJsonObject } from './extract-json';

export interface CorrectionVerdict {
  // false = Aaron déconseille d'écrire. `raison` dit pourquoi, et c'est ce
  // que le commercial lit.
  vaut_un_email: boolean;
  raison: string;
  objet: string | null;
  corps: string | null;
}

const FALLBACK: CorrectionVerdict = {
  vaut_un_email: false,
  raison: "Je n'ai pas réussi à analyser cette erreur. Relis le message et écris le rattrapage toi-même si tu le juges nécessaire.",
  objet: null,
  corps: null,
};

export async function draftCorrection(messageId: string, reason: string): Promise<CorrectionVerdict> {
  const { data: message } = await supabaseAdmin
    .from('messages')
    .select('id, body, direction, created_at, conversation_id, recipient_email, sender_email')
    .eq('id', messageId)
    .maybeSingle();
  if (!message || message.direction !== 'outbound') return FALLBACK;

  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('id, prospect_id, prospects(full_name, job_title, company_id, prospect_companies(name))')
    .eq('id', message.conversation_id)
    .maybeSingle();
  const prospect: any = (conversation as any)?.prospects || null;

  // Les quelques messages précédents : Aaron doit savoir ce que le prospect a
  // déjà reçu pour ne pas répéter ce qui a bien été dit.
  const { data: history } = await supabaseAdmin
    .from('messages')
    .select('direction, body, created_at')
    .eq('conversation_id', message.conversation_id)
    .order('created_at', { ascending: true })
    .limit(10);

  const { data: seller } = prospect?.company_id
    ? await supabaseAdmin.from('companies').select('name, business_summary').eq('id', prospect.company_id).maybeSingle()
    : { data: null as any };

  const prompt = `Un commercial vient de signaler qu'un email DÉJÀ ENVOYÉ à un prospect comporte une erreur. Tu dois d'abord juger si cela mérite un second message, puis le rédiger si oui.

CE QUE LE COMMERCIAL SIGNALE : ${reason}

L'EMAIL FAUTIF, tel qu'il est parti :
"""
${String(message.body || '').slice(0, 3000)}
"""

LE PROSPECT : ${prospect?.full_name || 'inconnu'}${prospect?.job_title ? `, ${prospect.job_title}` : ''}${prospect?.prospect_companies?.name ? `, chez ${prospect.prospect_companies.name}` : ''}
LE COMMERCIAL : ${seller?.name || 'inconnu'}${seller?.business_summary ? `\nSon activité : ${String(seller.business_summary).slice(0, 1200)}` : ''}

L'HISTORIQUE DE LA CONVERSATION (du plus ancien au plus récent) :
${(history || []).map((m: any) => `[${m.direction === 'outbound' ? 'nous' : 'le prospect'}] ${String(m.body || '').slice(0, 400)}`).join('\n---\n') || '(aucun autre message)'}

TON JUGEMENT D'ABORD.
Réponds "vaut_un_email": false quand l'erreur est mineure au point que le prospect ne l'a probablement pas remarquée : coquille, accent, ponctuation, tournure maladroite, formule de politesse imparfaite. Y revenir attirerait son attention sur une faute invisible et consommerait une occasion de le contacter pour rien. Dans ce cas, "raison" explique au commercial pourquoi tu déconseilles d'écrire, en une ou deux phrases, et "objet" et "corps" sont null.

Réponds "vaut_un_email": true quand l'erreur est visible ou porte à conséquence : message tronqué ou incompréhensible, mauvais prénom ou mauvaise société, information chiffrée fausse (prix, délai, quantité), message destiné à quelqu'un d'autre, promesse erronée. Dans ce cas, "raison" dit en une phrase pourquoi il faut écrire.

SI TU RÉDIGES, TROIS RÈGLES.
1. Assume en UNE phrase, au début, sans te justifier. Trois lignes d'excuses transforment un incident en malaise et mettent le prospect mal à l'aise.
2. Redonne immédiatement l'information juste, ou le message tel qu'il aurait dû être. Le but est de rattraper, pas de s'excuser.
3. Reste court. Un rattrapage réussi tient en quatre ou cinq lignes.

L'objet reprend celui de l'échange en cours préfixé de "Re: " : ce message part en RÉPONSE dans le fil existant, jamais comme nouveau message.

N'invente aucune information que tu ne trouves pas dans ce qui précède. Si le commercial signale une donnée fausse sans donner la bonne, écris le rattrapage en demandant au prospect de se référer à ce qui suivra, et signale-le dans "raison".

N'utilise jamais de tiret cadratin. Écris dans la langue de l'email fautif.

Réponds UNIQUEMENT avec cet objet JSON, sans texte avant ni après, sans balises markdown :
{"vaut_un_email": true, "raison": "string", "objet": "string ou null", "corps": "string ou null"}`;

  try {
    const data = await callClaude(
      { model: 'claude-sonnet-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] },
      prospect?.company_id || null,
      // Rattrapage d'un échange déjà engagé : même régime budgétaire qu'un
      // suivi, pas qu'une prospection nouvelle. Une par incident, donc borné.
      'as'
    );
    const textBlock = (data?.content || []).filter((b: any) => b.type === 'text').pop();
    if (!textBlock) return FALLBACK;
    const parsed = extractJsonObject<CorrectionVerdict>(textBlock.text);
    return {
      vaut_un_email: parsed?.vaut_un_email === true,
      raison: String(parsed?.raison || FALLBACK.raison),
      objet: parsed?.objet ? String(parsed.objet) : null,
      corps: parsed?.corps ? String(parsed.corps) : null,
    };
  } catch (err: any) {
    console.error('Rattrapage d\'email — analyse impossible :', err?.message || err);
    return FALLBACK;
  }
}
