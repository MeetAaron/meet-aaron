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

export interface LinkedInDraft {
  connection_note: string; // <= 300 caractères (limite LinkedIn pour une note de connexion)
  first_message: string; // message à envoyer une fois la connexion acceptée
  linkedin_url: string | null; // profil du contact si connu, sinon null (recherche manuelle nécessaire)
}

export async function generateLinkedInDraft(prospectId: string): Promise<LinkedInDraft> {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('full_name, job_title, linkedin_url, company_id, assigned_user_id, prospect_companies(name), users(locale)')
    .eq('id', prospectId)
    .single();

  if (error || !prospect) throw new Error('Prospect introuvable');

  // Pas d'historique d'échange à ce stade (premier contact LinkedIn) pour
  // détecter la langue du contact — on retombe sur celle du commercial, même
  // logique par défaut que le premier email d'Aaron (voir aaron_system_prompt.md).
  const locale = normalizeLocale((prospect as any).users?.locale);

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('business_summary')
    .eq('id', prospect.company_id)
    .maybeSingle();

  const prompt = `Tu es Aaron, copilote commercial IA. Un commercial va contacter ce contact sur LinkedIn manuellement \
(il collera lui-même le texte que tu proposes — tu n'envoies rien toi-même).

Contact : ${prospect.full_name}${prospect.job_title ? `, ${prospect.job_title}` : ''}${(prospect as any).prospect_companies?.name ? ` chez ${(prospect as any).prospect_companies.name}` : ''}.
${company?.business_summary ? `Activité de la société qui démarche : ${company.business_summary}` : ''}

Rédige, ${localeInstruction(locale)} :
1. Une note de demande de connexion LinkedIn, chaleureuse et personnalisée, PAS commerciale/vendeuse, \
280 caractères maximum (limite technique de LinkedIn) — l'objectif est juste d'être accepté, pas de vendre.
2. Un premier message à envoyer une fois la connexion acceptée, court (3-4 phrases), qui amène naturellement vers \
une prise de contact sans être trop direct.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour, sans balises markdown :
{"connection_note": "...", "first_message": "..."}`;

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    },
    prospect.company_id, 'ap'
  );

  const textBlock = data.content.find((b: any) => b.type === 'text');
  if (!textBlock) throw new Error('Aucune réponse reçue de Claude');

  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    connection_note: parsed.connection_note,
    first_message: parsed.first_message,
    linkedin_url: prospect.linkedin_url || null,
  };
}
