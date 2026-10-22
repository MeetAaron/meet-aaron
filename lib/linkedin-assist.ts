// lib/linkedin-assist.ts
// Assistant de démarchage LinkedIn — VOLONTAIREMENT sans automatisation.
//
// Pourquoi pas d'automatisation réelle (auto-connexion, auto-DM) : LinkedIn
// interdit explicitement dans ses conditions d'utilisation toute automatisation
// d'actions sur la plateforme sans passer par un partenariat officiel approuvé
// (Marketing Developer Platform), et détecte activement ce type de comportement
// — le risque n'est pas seulement pour Meet Aaron mais pour le COMPTE PERSONNEL
// du commercial (bannissement LinkedIn, potentiellement définitif). Il n'existe
// pas non plus d'API publique permettant d'envoyer une demande de connexion ou
// un message LinkedIn pour un compte individuel classique.
//
// Ce module reste donc dans les clous : Aaron rédige une proposition de note
// de connexion et de premier message, à partir du contexte du prospect — mais
// c'est le commercial qui colle et envoie lui-même, depuis SON compte LinkedIn,
// dans son navigateur. Zéro automatisation, zéro risque de bannissement.

import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';
import { localeInstruction, normalizeLocale } from './locale-instruction';
import { normalizeLinkedInProfileUrl } from './social-urls';

export interface LinkedInDraft {
  connection_note: string; // <= 300 caractères (limite LinkedIn pour une note de connexion)
  first_message: string; // message à envoyer une fois la connexion acceptée
  linkedin_url: string | null; // profil du contact si connu, sinon null (recherche manuelle nécessaire)
  // 22/10/2026 : profil PUBLIC trouvé par Aaron quand la fiche n'en avait
  // pas. true = « probable, à confirmer » : le commercial vérifie que c'est
  // la bonne personne avant de l'enregistrer (homonymes fréquents).
  linkedin_url_suggested: boolean;
}

// LinkedIn limite la note de connexion à 300 caractères : on coupe proprement
// (fin de phrase ou de mot) si le modèle a débordé, pour que le copier-coller
// passe toujours du premier coup.
function clampNote(note: string, max = 300): string {
  const s = (note || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

// Recherche du profil LinkedIn PUBLIC du contact (une recherche web, Haiku).
// Lecture de résultats de recherche publics uniquement : aucune connexion à
// LinkedIn, aucun scraping de compte.
async function findContactLinkedIn(
  clientCompanyId: string,
  fullName: string,
  jobTitle: string | null,
  companyName: string | null
): Promise<string | null> {
  if (!fullName || !companyName) return null; // sans société, trop d'homonymes
  const prompt =
    `Trouve l'URL du profil LinkedIn PUBLIC de cette personne :\n` +
    `Nom : ${fullName}\n${jobTitle ? `Poste : ${jobTitle}\n` : ''}Entreprise : ${companyName}\n\n` +
    `Ne retiens un profil que si le nom ET l'entreprise correspondent. ` +
    `Réponds UNIQUEMENT avec un objet JSON : {"linkedin_url": "https://www.linkedin.com/in/... ou null"}. ` +
    `N'INVENTE RIEN.`;
  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 200,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: prompt }],
      },
      clientCompanyId,
      'ap'
    );
    const text = data.content.filter((b: any) => b.type === 'text').pop()?.text || '';
    const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    return normalizeLinkedInProfileUrl(JSON.parse(match[0]).linkedin_url);
  } catch {
    return null;
  }
}

export async function generateLinkedInDraft(prospectId: string): Promise<LinkedInDraft> {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('full_name, job_title, linkedin_url, company_id, assigned_user_id, prospect_companies(*), users(locale)')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) throw new Error('Prospect introuvable');

  // Pas d'historique d'échange à ce stade (premier contact LinkedIn) pour
  // détecter la langue du contact — on retombe sur celle du commercial, même
  // logique par défaut que le premier email d'Aaron (voir aaron_system_prompt.md).
  const locale = normalizeLocale((prospect as any).users?.locale);

  const pc: any = (prospect as any).prospect_companies || null;

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', prospect.company_id)
    .maybeSingle();

  const prompt = `Tu es Aaron, copilote commercial IA. Un commercial va contacter ce contact sur LinkedIn manuellement \
(il collera lui-même le texte que tu proposes — tu n'envoies rien toi-même).

Contact : ${prospect.full_name}${prospect.job_title ? `, ${prospect.job_title}` : ''}${(prospect as any).prospect_companies?.name ? ` chez ${(prospect as any).prospect_companies.name}` : ''}.
${company?.business_summary ? `Activité de la société qui démarche : ${company.business_summary}` : ''}
${pc?.research_summary ? `Ce que fait l'entreprise du contact : ${pc.research_summary}` : ''}
${pc?.aaron_opinion ? `Ton analyse de cette entreprise (angle d'approche) : ${pc.aaron_opinion}` : ''}
${pc?.news_signal ? `Actualité récente de l'entreprise (tu peux t'en servir pour personnaliser) : ${pc.news_signal}` : ''}

Rédige, ${localeInstruction(locale)} :
1. Une note de demande de connexion LinkedIn, chaleureuse et personnalisée (appuie-toi sur un fait réel de son \
entreprise si tu en as un), PAS commerciale/vendeuse, 280 caractères maximum (limite technique de LinkedIn) — \
l'objectif est juste d'être accepté, pas de vendre.
2. Un premier message à envoyer une fois la connexion acceptée, court (3-4 phrases), qui amène naturellement vers \
une prise de contact sans être trop direct.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour, sans balises markdown :
{"connection_note": "...", "first_message": "..."}`;

  const data = await callClaude(
    {
      model: 'claude-sonnet-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    },
    prospect.company_id, 'ap'
  );

  const textBlock = data.content.find((b: any) => b.type === 'text');
  if (!textBlock) throw new Error('Aucune réponse reçue de Claude');

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  let linkedinUrl: string | null = prospect.linkedin_url || null;
  let suggested = false;
  if (!linkedinUrl) {
    linkedinUrl = await findContactLinkedIn(prospect.company_id, prospect.full_name, prospect.job_title || null, pc?.name || null);
    suggested = !!linkedinUrl;
  }

  return {
    connection_note: clampNote(String(parsed.connection_note || '')),
    first_message: String(parsed.first_message || '').trim(),
    linkedin_url: linkedinUrl,
    linkedin_url_suggested: suggested,
  };
}
