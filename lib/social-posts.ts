// lib/social-posts.ts
//
// AARON SOCIAL : LES 16 POSTS DU MOIS (20/11/2026).
//
// Règles validées par Alex (maquette du 18/11, décisions v3 et v4) :
//   - une campagne = 4 semaines = 16 posts, 4 par semaine ;
//   - 4 familles, une de chaque par semaine : réalisations en photo, clients
//     satisfaits, conseils de pro, offres et coulisses ;
//   - un sujet, quatre formes : le même post est adapté à Instagram
//     (carrousel), Facebook (photo et texte), LinkedIn (document, ton pro) et
//     TikTok (vidéo courte montée avec les photos du client, jamais générée) ;
//   - Aaron parle au nom de l'entreprise et ne se présente jamais ;
//   - la matière (plaquette, photos, avis) se collecte une fois : un post qui
//     a besoin d'une photo ou d'un avis le dit, au lieu d'en inventer.
//
// HONNÊTETÉ, non négociable : aucun client, chiffre, témoignage ou
// réalisation inventé. Ce qui n'est pas dans la fiche ou les documents de
// l'entreprise est demandé (material_needed), jamais imaginé. Un faux avis
// publié au nom d'une entreprise, c'est elle qu'on expose, pas nous.
//
// Génération : un appel par famille (4 posts chacun), pour des sujets variés
// à l'intérieur d'une famille. Rien n'est publié ici : on prépare seulement.

import { callClaude } from './anthropic-client';
import { localeInstruction, normalizeLocale } from './locale-instruction';
import { extractJsonObject } from './extract-json';
import { supabaseAdmin } from './supabase-admin';

export const SOCIAL_CATEGORIES = ['realisation', 'avis', 'conseil', 'coulisses'] as const;
export type SocialCategory = (typeof SOCIAL_CATEGORIES)[number];

// Créneaux de la semaine (heure locale de l'entreprise), dans l'ordre des
// familles : mardi 9 h 30, jeudi 12 h 15, samedi 10 h, dimanche 18 h — ceux
// de la maquette validée. À affiner quand les statistiques de publication
// existeront.
export const SOCIAL_SLOTS: { weekday: number; hour: number; minute: number }[] = [
  { weekday: 2, hour: 9, minute: 30 },
  { weekday: 4, hour: 12, minute: 15 },
  { weekday: 6, hour: 10, minute: 0 },
  { weekday: 7, hour: 18, minute: 0 },
];

export type MaterialNeed = 'none' | 'photo' | 'avis';

export interface SocialPostContent {
  instagram: { slides: string[]; caption: string };
  facebook: { text: string };
  linkedin: { slides: string[]; text: string };
  tiktok: { scenes: string[]; caption: string };
}

export interface GeneratedPost {
  category: SocialCategory;
  subject: string;
  material_needed: MaterialNeed;
  material_hint: string | null;
  content: SocialPostContent;
}

const CATEGORY_BRIEF: Record<SocialCategory, string> = {
  realisation:
    "RÉALISATIONS EN PHOTO : un travail concret que l'entreprise a fait ou sait faire, montré en images (avant/après, étapes, résultat). Si la fiche ou les documents citent une réalisation précise, pars d'elle. Sinon, décris le TYPE de réalisation et demande la photo (material_needed = \"photo\") sans inventer le client ni le lieu.",
  avis:
    "CLIENTS SATISFAITS : la parole d'un client. Tu ne peux utiliser QU'UN avis ou un résultat réellement écrit dans la fiche ou les documents ; recopie-le fidèlement et sans nom si aucun nom n'est donné. S'il n'y en a pas assez pour 4 posts, écris le post autour d'un emplacement [avis client] et mets material_needed = \"avis\". Jamais un faux témoignage.",
  conseil:
    "CONSEILS DE PRO : un conseil utile tiré du métier de l'entreprise, que son client idéal peut appliquer seul. C'est la famille où tu n'as besoin de rien : material_needed = \"none\".",
  coulisses:
    "OFFRES ET COULISSES : une offre réelle de l'entreprise (seulement si elle figure dans la fiche ou les documents, prix compris), ou un moment des coulisses (l'équipe, la préparation, l'outil). Une photo de l'équipe ou du lieu est souvent nécessaire : material_needed = \"photo\" dans ce cas.",
};

function postsPrompt(category: SocialCategory, companyName: string, profile: string, documents: string, locale: string): string {
  return [
    `Tu prépares les publications de l'entreprise « ${companyName} » sur ses réseaux sociaux. Tu parles EN SON NOM (« nous »), comme son équipe le ferait. Tu ne te présentes jamais, tu ne parles jamais d'IA ni d'assistant.`,
    '',
    `Famille de posts à écrire : ${CATEGORY_BRIEF[category]}`,
    '',
    "Écris 4 posts de cette famille, sur 4 sujets différents, pour 4 semaines de suite. Chaque sujet est décliné en quatre formes :",
    "- instagram : un carrousel de 5 diapositives (une phrase courte par diapositive, la première accroche, la dernière invite à écrire en commentaire ou en message) + une légende de 2 à 4 phrases et 3 à 5 hashtags à la fin ;",
    "- facebook : un texte complet de 3 à 6 phrases, sans hashtag, qui se termine par une question simple ;",
    "- linkedin : un document de 5 pages (une phrase par page, ton professionnel) + un texte de 3 à 5 phrases, au plus 3 hashtags ;",
    "- tiktok : 5 scènes de 2 à 3 secondes chacune (le texte affiché à l'écran sur les photos de l'entreprise) + une légende d'une phrase et 3 hashtags.",
    '',
    'Règles :',
    "- Rien d'inventé : pas de client, de chiffre, de prix, de délai ou de récompense qui ne figure pas ci-dessous. Si un post a besoin d'une photo ou d'un avis que tu n'as pas, dis-le dans material_needed et material_hint (ce qu'il faut fournir, en une phrase), et écris le texte pour qu'il reste vrai.",
    "- Une seule idée par post, des phrases courtes, aucun émoji, aucun tiret long.",
    "- L'appel à l'action invite à écrire en commentaire ou en message privé, jamais à cliquer sur un lien.",
    `- Écris tout ${localeInstruction(locale)}, y compris les hashtags.`,
    '',
    'Réponds UNIQUEMENT par un objet JSON, sans texte autour :',
    '{"posts":[{"subject":"…","material_needed":"none|photo|avis","material_hint":"… ou null","instagram":{"slides":["…","…","…","…","…"],"caption":"…"},"facebook":{"text":"…"},"linkedin":{"slides":["…","…","…","…","…"],"text":"…"},"tiktok":{"scenes":["…","…","…","…","…"],"caption":"…"}}]}',
    '',
    "Fiche de l'entreprise :",
    '"""',
    profile || '(aucune fiche)',
    '"""',
    '',
    "Documents de l'entreprise (extraits) :",
    '"""',
    documents || '(aucun document)',
    '"""',
  ].join('\n');
}

function cleanText(value: any, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+\n/g, '\n').trim().slice(0, max) : '';
}

function cleanList(value: any, count: number, max: number): string[] {
  const list = Array.isArray(value) ? value.map((v) => cleanText(v, max)).filter(Boolean) : [];
  return list.slice(0, count);
}

function cleanPost(category: SocialCategory, raw: any): GeneratedPost | null {
  if (!raw || typeof raw !== 'object') return null;
  const subject = cleanText(raw.subject, 160);
  const need: MaterialNeed = raw.material_needed === 'photo' || raw.material_needed === 'avis' ? raw.material_needed : 'none';
  const content: SocialPostContent = {
    instagram: { slides: cleanList(raw.instagram?.slides, 5, 220), caption: cleanText(raw.instagram?.caption, 1500) },
    facebook: { text: cleanText(raw.facebook?.text, 2000) },
    linkedin: { slides: cleanList(raw.linkedin?.slides, 5, 220), text: cleanText(raw.linkedin?.text, 2000) },
    tiktok: { scenes: cleanList(raw.tiktok?.scenes, 5, 120), caption: cleanText(raw.tiktok?.caption, 300) },
  };
  if (!subject || !content.facebook.text || content.instagram.slides.length === 0) return null;
  return {
    category,
    subject,
    material_needed: need,
    material_hint: need === 'none' ? null : cleanText(raw.material_hint, 240) || null,
    content,
  };
}

async function companyMaterial(companyId: string): Promise<{ name: string; profile: string; documents: string }> {
  const [{ data: company }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('companies').select('name, business_summary').eq('id', companyId).maybeSingle(),
    supabaseAdmin
      .from('company_documents')
      .select('file_name, summary, extracted_text, included_in_aaron_context')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);
  const usable = ((docs || []) as any[]).filter((d) => d.included_in_aaron_context !== false).slice(0, 3);
  const documents = usable
    .map((d) => `[${d.file_name}]\n${String(d.extracted_text || d.summary || '').replace(/\s+/g, ' ').slice(0, 2500)}`)
    .join('\n\n');
  return {
    name: (company as any)?.name || 'notre entreprise',
    profile: String((company as any)?.business_summary || '').slice(0, 9000),
    documents,
  };
}

// Prépare les 4 posts d'UNE famille (un appel au modèle, environ 2 000 mots
// en sortie). L'écran lance les 4 familles en parallèle, chacune dans sa
// propre requête : chaque appel tient ainsi largement dans la limite de
// 60 secondes d'une fonction, et une famille qui échoue se relance seule.
export async function generateCategoryPosts(
  companyId: string,
  category: SocialCategory,
  locale: string,
  userId: string | null
): Promise<GeneratedPost[]> {
  const material = await companyMaterial(companyId);
  const data = await callClaude(
    {
      model: 'claude-sonnet-5',
      max_tokens: 5000,
      messages: [{ role: 'user', content: postsPrompt(category, material.name, material.profile, material.documents, normalizeLocale(locale)) }],
    },
    companyId,
    'as',
    userId,
    'reseaux_sociaux'
  );
  const text = (data.content || []).find((b: any) => b.type === 'text')?.text || '';
  const parsed = extractJsonObject<{ posts?: any[] }>(text);
  return ((parsed?.posts || []).map((p) => cleanPost(category, p)).filter(Boolean) as GeneratedPost[]).slice(0, 4);
}
