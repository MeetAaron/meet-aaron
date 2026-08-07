// lib/aaron.ts
// Le "cerveau" d'Aaron : construit le contexte, appelle Claude (API Anthropic),
// et parse la réponse structurée en JSON pour que le reste du backend l'exploite.

import { supabaseAdmin } from './supabase-admin';
import { readFileSync } from 'fs';
import path from 'path';

// Le prompt système d'Aaron est stocké en dur dans le repo (voir aaron_system_prompt.md)
const AARON_SYSTEM_PROMPT = readFileSync(
  path.join(process.cwd(), 'lib', 'aaron_system_prompt.md'),
  'utf-8'
);

interface AaronOutput {
  email_draft: { subject: string; body: string };
  prospect_status: 'vert' | 'jaune' | 'orange' | 'rouge' | 'bleu';
  personality_type: 'dominant' | 'influent' | 'stable' | 'consciencieux' | null;
  personality_notes: string | null;
  aaron_advice: string;
  appointment_proposal: {
    detected: boolean;
    type: 'telephonique' | 'physique' | 'visio';
    proposed_datetime: string;
    requires_sales_validation: boolean;
  } | null;
  action_required_from_sales: string | null;
}

// Construit le contexte complet à injecter dans le message utilisateur envoyé à Claude
async function buildContext(prospectId: string) {
  const { data: prospect } = await supabaseAdmin
    .from('prospects')
    .select('*, users(full_name, email), prospect_companies(name, domain, is_won_client)')
    .eq('id', prospectId)
    .single();

  if (!prospect) throw new Error('Prospect introuvable');

  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id, messages(direction, body, sent_at)')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true });

  // Détecte s'il y a d'autres contacts de la même société (pour le contexte multi-contacts)
  let siblingContacts: any[] = [];
  if (prospect.prospect_company_id) {
    const { data } = await supabaseAdmin
      .from('prospects')
      .select('full_name, job_title, status, is_won')
      .eq('prospect_company_id', prospect.prospect_company_id)
      .neq('id', prospectId);
    siblingContacts = data || [];
  }

  return {
    commercial: {
      nom: prospect.users.full_name,
      email: prospect.users.email,
    },
    prospect: {
      nom: prospect.full_name,
      email: prospect.email,
      poste: prospect.job_title,
      societe: prospect.prospect_companies?.name,
    },
    statut_actuel: prospect.status,
    personnalite_detectee: prospect.personality_type,
    historique_conversation: conversations,
    autres_contacts_meme_societe: siblingContacts,
    societe_deja_cliente: prospect.prospect_companies?.is_won_client || false,
  };
}

// Appelle Claude avec le prompt système d'Aaron + le contexte, retourne la réponse structurée
export async function generateAaronResponse(prospectId: string): Promise<AaronOutput> {
  const context = await buildContext(prospectId);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: AARON_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Voici le contexte complet de la situation. Réponds UNIQUEMENT avec l'objet JSON structuré défini dans le prompt système, sans aucun texte avant ou après, sans balises markdown.\n\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur API Anthropic: ${err}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((block: any) => block.type === 'text');

  if (!textBlock) {
    throw new Error('Aucune réponse texte reçue de Claude');
  }

  // Nettoyage au cas où Claude ajoute des balises ```json malgré la consigne
  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as AaronOutput;
  } catch (e) {
    console.error('Réponse Aaron non parsable:', textBlock.text);
    throw new Error('Réponse Aaron mal formée (JSON invalide)');
  }
}
