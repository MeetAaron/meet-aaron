// app/api/business-summary/route.ts
// POST -> génère (via Claude) un résumé de l'activité de la société, à partir
// des synthèses de documents déjà disponibles (chantier "synthèse documents")
// et de la description donnée par l'utilisateur dans le chat lors de l'accueil.
// Le résumé est stocké sur companies.business_summary et réutilisé par Aaron
// (contexte enrichi) sans avoir à relire les documents à chaque fois.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-helpers';
import { callClaude, MonthlyCapExceededError } from '@/lib/anthropic-client';
import { localeInstruction } from '@/lib/locale-instruction';
// Filet de sécurité (demande Alex, 29/08/2026, suite à la perte du résumé du
// compte "Open X", étendu le même jour à un historique des 5 dernières
// versions plutôt qu'une seule) : business_summary est ici entièrement
// REMPLACÉ (pas complété comme l'ajout via le chat, voir
// runMettreAJourProfilEntreprise dans app/api/chat/route.ts) — avant chaque
// remplacement complet (POST régénération ou PATCH correction manuelle),
// l'ancienne valeur est copiée dans business_summary_versions. Logique
// partagée avec app/api/business-summary/versions/route.ts (réactivation
// d'une ancienne version) — voir lib/business-summary-store.ts.
import { backupThenReplaceBusinessSummary } from '@/lib/business-summary-store';

// GET -> relit le résumé métier déjà généré, pour qu'un commercial puisse le
// retrouver et le consulter à tout moment depuis "Préférences" (pas seulement
// juste après l'onboarding).
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== userId) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  // `any` : les deux variantes de chaîne de colonnes donnent des types
  // Postgrest incompatibles, alors que la forme runtime est identique.
  //
  // Repli sur 42703 (01/09/2026, bug remonté par Alex : « Mon entreprise »
  // affichait "Pas encore de résumé" alors que le PDF téléchargé contenait
  // bien le profil). Cause : si les colonnes business_summary_pending_*
  // n'existent pas encore en base (migration_business_profile_pending_
  // 2026-08-27.sql pas passée), TOUTE la requête échoue — `company` vaut
  // null — et la route répondait alors 200 avec summary: null, donc un
  // profil parfaitement présent s'affichait comme vide. L'export PDF, lui,
  // ne demandait pas ces colonnes et fonctionnait : d'où l'incohérence.
  let res: any = await supabaseAdmin
    .from('companies')
    .select(
      'business_summary, business_summary_pending_text, business_summary_pending_file_name, business_summary_pending_uploaded_at'
    )
    .eq('id', user.company_id)
    .single();
  if (res.error && res.error.code === '42703') {
    res = await supabaseAdmin
      .from('companies')
      .select('business_summary')
      .eq('id', user.company_id)
      .single();
  }
  // Une erreur qui n'est PAS "colonne absente" (droits, panne réseau...) ne
  // doit surtout pas être rendue comme "profil vide" : l'UI sait afficher un
  // vrai message d'erreur (summaryLoadError) sur un statut non-200.
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const company: any = res.data;

  // pending : présent uniquement si un document modifié a été importé et
  // n'a pas encore été traité ("Ne pas analyser" ou "Faire analyser par
  // Aaron", voir app/api/business-summary/import/*) — sinon null, pour que
  // l'UI sache s'il faut afficher la bannière de revue.
  const pending = company?.business_summary_pending_text
    ? {
        fileName: company.business_summary_pending_file_name,
        uploadedAt: company.business_summary_pending_uploaded_at,
      }
    : null;

  return NextResponse.json({ summary: company?.business_summary || null, pending });
}

// PATCH -> permet au commercial de corriger/étoffer le résumé à la main,
// sans repasser par une régénération via Claude.
export async function PATCH(request: NextRequest) {
  const { user_id, summary } = await request.json();

  if (!user_id || typeof summary !== 'string') {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user } = await supabaseAdmin.from('users').select('company_id').eq('id', user_id).single();
  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  const { error } = await backupThenReplaceBusinessSummary(user.company_id, summary.trim());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const { user_id, description, qa } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'user_id manquant' }, { status: 400 });
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();
  if (authedUser.id !== user_id) return forbiddenResponse();

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('company_id')
    .eq('id', user_id)
    .single();

  if (userError) {
    console.error('Erreur récupération utilisateur (business-summary):', userError.message);
  }

  if (!user?.company_id) {
    return NextResponse.json({ error: 'Société introuvable pour cet utilisateur' }, { status: 404 });
  }

  // CHANGEMENTS A FAIRE #89 (2026-08-16) : corrige une requête qui sélectionnait
  // une colonne "name" inexistante sur company_documents (la colonne s'appelle
  // file_name) — Supabase renvoyait une erreur silencieusement absorbée par le
  // `data` undefined, si bien que ce résumé n'incluait jamais aucun document.
  // Filtre aussi désormais sur included_in_aaron_context (voir
  // migration_documents_2026-08-16.sql), comme les autres endroits où Aaron
  // s'appuie sur les documents de la société.
  const { data: documents } = await supabaseAdmin
    .from('company_documents')
    .select('file_name, summary')
    .eq('company_id', user.company_id)
    .eq('included_in_aaron_context', true)
    .order('created_at', { ascending: false })
    .limit(8);

  const documentSummaries = (documents || [])
    .filter((d) => d.summary)
    .map((d) => `- ${d.file_name} : ${d.summary}`)
    .join('\n');

  // Réponses structurées au questionnaire de découverte guidé (voir app/app/chat/page.jsx) —
  // bien plus exploitables pour le modèle qu'un unique pavé de texte libre.
  const qaText = Array.isArray(qa) && qa.length
    ? qa.map((item: any) => `Q: ${item.question || '(réponse libre)'}\nR: ${item.answer}`).join('\n\n')
    : '';

  if (!documentSummaries && !description && !qaText) {
    return NextResponse.json(
      { error: "Pas encore assez d'informations — ajoutez au moins un document ou une description." },
      { status: 400 }
    );
  }

  // Profil d'entreprise enrichi (demande Alex, 29/08/2026 : "tu es le
  // meilleur commercial du monde, qu'est-ce qui devrait être dans une fiche
  // entreprise pour qu'elle soit parfaite ? fais le"). Remplace l'ancien
  // résumé court (5-9 phrases, un seul paragraphe) par un vrai document
  // structuré en sections — chaque section a un double usage explicitement
  // demandé par Alex : (1) c'est le contexte qu'Aaron relit pour prospecter
  // en connaissant parfaitement la société qu'il représente, (2) c'est aussi
  // un document que l'utilisateur peut télécharger et utiliser hors Aaron
  // (CRM, banque, présentation) via l'export Word/PDF existant (voir
  // app/api/business-summary/export/route.ts). Les 8 sections ci-dessous
  // reprennent chaque thème du questionnaire de découverte guidé (voir
  // ONBOARDING_QUESTION_KEYS, app/app/chat/page.jsx) — le modèle reçoit les
  // questions/réponses en toutes lettres dans qaText et les range lui-même
  // dans la bonne section, sans clé technique à faire correspondre. Chaque
  // section est marquée par un titre "## " (voir lib/business-profile-format.ts,
  // reconnu par les deux exports RTF/PDF pour un vrai rendu en titre) et doit
  // être OMISE ENTIÈREMENT si aucune information ne permet de la remplir —
  // jamais de placeholder "non renseigné" ni de généralité inventée pour
  // combler une section vide (principe déjà en place pour "Légitimité :" et
  // "Preuve sociale :", étendu ici à l'ensemble du document).
  //
  // Génération de graphiques et accès Internet en temps réel pour Aaron :
  // explicitement hors scope de ce chantier (voir
  // claude/statut-2026-08-29-chat-doc-typo-profil-entreprise.md, section 9) —
  // sujets distincts à traiter séparément si Alex les confirme.
  const prompt =
    `Tu es Aaron, copilote commercial IA, et aussi le meilleur commercial du monde. Un commercial vient de te ` +
    `fournir des informations sur son entreprise pour que tu rédiges sa "fiche profil d'entreprise" : un document ` +
    `de référence complet qui te servira à toi (pour le représenter parfaitement en prospection) et à lui-même ` +
    `(il pourra le télécharger et s'en servir dans son CRM, en banque, en présentation).\n\n` +
    (documentSummaries ? `Documents fournis par le commercial (déjà résumés) :\n${documentSummaries}\n\n` : '') +
    (qaText ? `Réponses du commercial à un questionnaire de découverte :\n${qaText}\n\n` : '') +
    (description && !qaText ? `Description donnée à l'oral par le commercial :\n"""${description}"""\n\n` : '') +
    `Rédige cette fiche profil d'entreprise sous forme de sections, chacune précédée d'un titre au format ` +
    `Markdown "## Titre de la section" sur sa propre ligne, suivi d'un paragraphe rédigé en prose (pas de puces). ` +
    `Utilise autant que possible ces 8 sections, dans cet ordre :\n` +
    `## Présentation de l'entreprise (secteur d'activité, ce qu'elle fait/vend, en une vue d'ensemble)\n` +
    `## Clientèle cible (taille des clients visés, un profil homogène ou plusieurs profils distincts, ` +
    `comportement/caractère de ces clients)\n` +
    `## Offre phare (le produit ou service phare, en t'appuyant aussi sur les documents fournis type plaquette ` +
    `ou catalogue si disponibles)\n` +
    `## Ce qui différencie l'entreprise (par rapport à ses concurrents)\n` +
    `## Légitimité et preuves concrètes (à l'intérieur de cette section uniquement : si le commercial a donné des ` +
    `éléments concrets prouvant son expérience/expertise — années d'expérience, certifications, nombre de clients ` +
    `ou réalisations, spécialisation, références notables — mets-les dans une phrase séparée commençant par ` +
    `"Légitimité :" ; si le commercial a donné un exemple concret de client satisfait, un résultat chiffré ou une ` +
    `transformation obtenue par un client, mets-le dans une autre phrase séparée commençant par "Preuve sociale :" ` +
    `— ce sont deux choses différentes, ne les fusionne pas dans la même phrase)\n` +
    `## Argumentaire commercial (l'argument de vente qui fait le plus mouche, et l'objection la plus fréquente ` +
    `avec la manière de la lever)\n` +
    `## Déclencheurs d'achat (ce qui pousse concrètement un prospect à passer à l'action)\n` +
    `## Objectif de conversion (le type de conclusion à viser après un premier contact : RDV, devis, essai ` +
    `gratuit, autre)\n\n` +
    `RÈGLE ABSOLUE, la plus importante de toutes : n'invente RIEN. Si les informations fournies ne permettent pas ` +
    `de remplir une section avec un contenu concret et vrai, SUPPRIME CETTE SECTION ENTIÈREMENT (son titre inclus) ` +
    `plutôt que d'écrire une généralité vague ou un contenu fabriqué pour la remplir. Chaque phrase du document ` +
    `doit pouvoir être reliée à une information réellement donnée par le commercial. ` +
    `Réponds uniquement avec ce document, ${localeInstruction(authedUser.locale)}, sans préambule ni titre général ` +
    `avant la première section "## ".`;

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-4-6',
        // Relevé de 500 à 3500 (29/08/2026, passage au profil d'entreprise
        // enrichi multi-sections) : jusqu'à 8 sections rédigées en prose,
        // largement au-delà de l'ancien résumé de 5-9 phrases. La longueur
        // réelle reste dictée par la richesse des réponses du commercial
        // (règle "n'invente rien" ci-dessus) — ce plafond est un maximum, pas
        // un objectif à atteindre.
        max_tokens: 3500,
        messages: [{ role: 'user', content: prompt }],
      },
      user.company_id
    );

    const textBlock = data.content.find((b: any) => b.type === 'text');
    const summary = textBlock?.text?.trim() || null;

    if (!summary) {
      return NextResponse.json({ error: 'Réponse vide du modèle' }, { status: 502 });
    }

    await backupThenReplaceBusinessSummary(user.company_id, summary);

    return NextResponse.json({ summary });
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) {
      return NextResponse.json(
        {
          error:
            err.reason === 'daily'
              ? "Plafond de dépense API du jour atteint pour votre société — ça repart automatiquement demain."
              : "Le plafond de dépense API mensuel de votre société est atteint — contactez votre administrateur.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 });
  }
}
