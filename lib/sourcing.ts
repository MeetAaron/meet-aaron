// lib/sourcing.ts
// Permet à Aaron de trouver lui-même des entreprises et des contacts à démarcher,
// en utilisant la recherche web en temps réel (outil web_search de l'API Anthropic).

import { supabaseAdmin } from './supabase-admin';

// Doit rester synchronisé avec COMPANY_SIZE_OPTIONS dans app/app/campaigns/page.jsx
// (les clés stockées en base sont ces mêmes clés courtes ; on ne convertit en
// libellé lisible qu'ici, au moment de construire le prompt de recherche).
const COMPANY_SIZE_LABELS: Record<string, string> = {
  artisan_tpe: 'Artisan / TPE (1 à 9 salariés)',
  pme: 'PME (10 à 249 salariés)',
  eti: 'ETI (250 à 4999 salariés)',
  grand_compte: 'Grand compte (5000 salariés et plus)',
};

interface FoundCompany {
  name: string;
  domain: string | null;
  address: string | null;
  city: string | null;
  website: string | null;
  source_url: string | null;
}

interface FoundContact {
  full_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

async function searchCompaniesInZone(
  sectorKeywords: string[],
  zoneLabel: string,
  companySizeKeys: string[],
  excludeDomains: string[],
  count: number
): Promise<FoundCompany[]> {
  const companySizeLabels = (companySizeKeys || []).map((k) => COMPANY_SIZE_LABELS[k]).filter(Boolean);

  const prompt = `Tu es un assistant de sourcing B2B. Cherche sur le web (Google Maps, annuaires professionnels, pages "contact" d'entreprises) des entreprises correspondant à ces critères :

Secteur(s) : ${sectorKeywords.join(', ')}
Zone géographique : ${zoneLabel}
${companySizeLabels.length ? `Taille d'entreprise recherchée : ${companySizeLabels.join(' ou ')}\n` : ''}Nombre d'entreprises à trouver : ${count}

Exclus ces domaines déjà connus : ${excludeDomains.join(', ') || 'aucun'}

Réponds UNIQUEMENT avec un tableau JSON (sans texte avant/après, sans balises markdown) au format :
[
  {
    "name": "Nom de l'entreprise",
    "domain": "exemple.com ou null si inconnu",
    "address": "adresse complète ou null",
    "city": "ville ou null",
    "website": "URL du site ou null",
    "source_url": "URL de la page où l'info a été trouvée"
  }
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur recherche entreprises: ${await response.text()}`);
  }

  const data = await response.json();
  const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
  if (!textBlock) return [];

  try {
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as FoundCompany[];
  } catch {
    console.error('Réponse sourcing entreprises non parsable:', textBlock.text);
    return [];
  }
}

async function searchContactAtCompany(company: FoundCompany, sectorKeywords: string[]): Promise<FoundContact | null> {
  const prompt = `Tu cherches un contact décisionnaire pertinent (dirigeant, gérant, responsable achats/commercial) au sein de cette entreprise, pour une prospection B2B dans le secteur : ${sectorKeywords.join(', ')}.

Entreprise : ${company.name}
Site web : ${company.website || 'inconnu'}
Ville : ${company.city || 'inconnue'}

Cherche sur LinkedIn, le site web de l'entreprise (page "équipe"/"contact"/mentions légales), et les annuaires professionnels.

Réponds UNIQUEMENT avec un objet JSON (sans texte avant/après, sans balises markdown) au format :
{
  "full_name": "Prénom Nom ou null si introuvable",
  "job_title": "poste ou null",
  "email": "email ou null si introuvable",
  "phone": "téléphone ou null si introuvable",
  "linkedin_url": "URL LinkedIn ou null"
}

Si tu ne trouves aucun contact fiable, réponds avec toutes les valeurs à null plutôt que d'inventer une information.`;

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
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Erreur recherche contact: ${await response.text()}`);
  }

  const data = await response.json();
  const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
  if (!textBlock) return null;

  try {
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as FoundContact;
  } catch {
    console.error('Réponse sourcing contact non parsable:', textBlock.text);
    return null;
  }
}

export async function processCampaignBatch(campaignId: string, batchSize: number = 5) {
  const { data: campaign } = await supabaseAdmin
    .from('prospecting_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (!campaign || campaign.status === 'terminee') return { done: true };

  const { data: existingCompanies } = await supabaseAdmin
    .from('prospect_companies')
    .select('domain')
    .eq('company_id', campaign.company_id);

  const excludeDomains = (existingCompanies || []).map((c) => c.domain).filter(Boolean) as string[];

  const foundCompanies = await searchCompaniesInZone(
    campaign.sector_keywords,
    campaign.zone_label,
    campaign.company_sizes || [],
    excludeDomains,
    batchSize
  );

  let newContactsCount = 0;
  let usableCompaniesCount = 0;

  for (const company of foundCompanies) {
    if (!company.domain) continue;
    usableCompaniesCount++;

    const { data: prospectCompany, error: companyError } = await supabaseAdmin
      .from('prospect_companies')
      .upsert(
        {
          company_id: campaign.company_id,
          domain: company.domain,
          name: company.name,
          found_by_campaign_id: campaign.id,
          source_url: company.source_url,
        },
        { onConflict: 'company_id,domain' }
      )
      .select('id')
      .single();

    if (companyError || !prospectCompany) continue;

    const { data: existingProspect } = await supabaseAdmin
      .from('prospects')
      .select('id')
      .eq('prospect_company_id', prospectCompany.id)
      .limit(1)
      .maybeSingle();

    if (existingProspect) continue;

    const contact = await searchContactAtCompany(company, campaign.sector_keywords);

    if (!contact || !contact.email) continue;

    await supabaseAdmin.from('prospects').insert({
      company_id: campaign.company_id,
      assigned_user_id: campaign.assigned_user_id,
      prospect_company_id: prospectCompany.id,
      full_name: contact.full_name || 'Contact à identifier',
      email: contact.email,
      phone: contact.phone,
      job_title: contact.job_title,
      status: 'jaune',
    });

    newContactsCount++;
  }

  const totalContacts = campaign.contacts_found + newContactsCount;
  const isComplete = totalContacts >= campaign.target_count;

  await supabaseAdmin
    .from('prospecting_campaigns')
    .update({
      // Ne compte que les entreprises réellement exploitables (avec domaine identifié) —
      // sinon le stat "entreprises analysées" affiché à l'écran grossit même quand
      // certaines trouvailles sont ignorées faute de domaine.
      companies_found: campaign.companies_found + usableCompaniesCount,
      contacts_found: totalContacts,
      status: isComplete ? 'terminee' : 'en_cours',
    })
    .eq('id', campaignId);

  return { done: isComplete, newContactsCount };
}
