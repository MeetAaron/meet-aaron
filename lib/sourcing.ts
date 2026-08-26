// lib/sourcing.ts
// Permet à Aaron de trouver lui-même des entreprises et des contacts à démarcher,
// en utilisant la recherche web en temps réel (outil web_search de l'API Anthropic).

import { supabaseAdmin } from './supabase-admin';
import { callClaude } from './anthropic-client';
import { researchProspectCompany } from './prospect-research';

// Doit rester synchronisé avec COMPANY_SIZE_OPTIONS dans app/app/campaigns/page.jsx
// (les clés stockées en base sont ces mêmes clés courtes ; on ne convertit en
// libellé lisible qu'ici, au moment de construire le prompt de recherche).
const COMPANY_SIZE_LABELS: Record<string, string> = {
  artisan_tpe: 'Artisan / TPE (1 à 9 salariés)',
  pme: 'PME (10 à 249 salariés)',
  eti: 'ETI (250 à 4999 salariés)',
  grand_compte: 'Grand compte (5000 salariés et plus)',
};

// Doit rester synchronisé avec ROLE_OPTIONS dans app/app/campaigns/page.jsx.
const TARGET_ROLE_LABELS: Record<string, string> = {
  fondateur_dirigeant: 'le fondateur ou dirigeant de l\'entreprise',
  responsable_commercial: 'le responsable commercial ou des ventes',
  responsable_achats: 'le responsable achats',
  rh: 'le responsable RH ou recrutement',
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
  companyId: string,
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

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      // max_uses borne le nombre de recherches web que le modèle peut lancer
      // pour CET appel — sans cette limite, un seul prompt peut déclencher un
      // nombre de recherches non borné (facturées en plus des tokens), ce qui
      // était identifié comme le principal poste de coût API non maîtrisé
      // (voir statut projet, "vitesse & coût API"). Ne change ni le format de
      // réponse attendu ni la qualité : borne juste le pire cas.
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: prompt }],
    },
    companyId, 'ap'
  );

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

async function searchContactAtCompany(
  companyId: string,
  company: FoundCompany,
  sectorKeywords: string[],
  targetRole?: string | null,
  companySizeKeys?: string[]
): Promise<FoundContact | null> {
  // Priorité : rôle explicitement demandé par le commercial > défaut logique
  // pour les toutes petites structures (chez un artisan/TPE/auto-entrepreneur,
  // c'est quasi toujours le fondateur lui-même qui décide, il n'y a souvent
  // personne d'autre à cibler) > défaut générique.
  const isSmallStructureOnly =
    Array.isArray(companySizeKeys) && companySizeKeys.length === 1 && companySizeKeys[0] === 'artisan_tpe';

  const roleInstruction =
    (targetRole && TARGET_ROLE_LABELS[targetRole]) ||
    (isSmallStructureOnly
      ? "le fondateur, gérant ou dirigeant (chez une structure de cette taille, c'est presque toujours la personne qui décide)"
      : 'un décisionnaire pertinent (dirigeant, gérant, responsable achats ou commercial selon ce qui est trouvable)');

  const prompt = `Tu cherches ${roleInstruction} au sein de cette entreprise, pour une prospection B2B dans le secteur : ${sectorKeywords.join(', ')}.

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

  const data = await callClaude(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      // Même borne que searchCompaniesInZone ci-dessus, avec un plafond plus
      // bas puisqu'il s'agit de chercher UN contact dans UNE entreprise déjà
      // identifiée (moins de recherches nécessaires qu'une découverte de zone).
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: prompt }],
    },
    companyId, 'ap'
  );

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
    campaign.company_id,
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
      .select('id, research_summary, website, siret, address, industry')
      .single();

    if (companyError || !prospectCompany) continue;

    // Même logique de maîtrise + auto-complétion de la société contactée que
    // l'ajout manuel (voir app/api/prospects/route.ts et
    // lib/prospect-research.ts) — une société trouvée par campagne a quasi
    // toujours un vrai domaine/site, donc quasi toujours recherchable. Ne
    // bloque jamais le traitement du lot en cas d'échec, et ne complète
    // chaque champ que s'il est encore vide (jamais écraser company.website
    // déjà trouvé par searchCompaniesInZone ci-dessus).
    if (!prospectCompany.research_summary) {
      try {
        const research = await researchProspectCompany(campaign.company_id, {
          name: company.name || null,
          domain: company.domain || null,
          website: company.website || prospectCompany.website || null,
          industry: prospectCompany.industry || null,
        });
        if (research) {
          const researchUpdate: Record<string, any> = { research_checked_at: new Date().toISOString() };
          if (research.summary) researchUpdate.research_summary = research.summary;
          if (research.website && !prospectCompany.website) researchUpdate.website = research.website;
          if (research.siret && !prospectCompany.siret) researchUpdate.siret = research.siret;
          if (research.address && !prospectCompany.address) researchUpdate.address = research.address;
          if (research.industry && !prospectCompany.industry) researchUpdate.industry = research.industry;
          await supabaseAdmin.from('prospect_companies').update(researchUpdate).eq('id', prospectCompany.id);
        } else {
          await supabaseAdmin
            .from('prospect_companies')
            .update({ research_checked_at: new Date().toISOString() })
            .eq('id', prospectCompany.id);
        }
      } catch (err: any) {
        console.error('Erreur recherche web société prospect (campagne, non bloquant):', err.message);
      }
    }

    const { data: existingProspect } = await supabaseAdmin
      .from('prospects')
      .select('id')
      .eq('prospect_company_id', prospectCompany.id)
      .limit(1)
      .maybeSingle();

    if (existingProspect) continue;

    const contact = await searchContactAtCompany(
      campaign.company_id,
      company,
      campaign.sector_keywords,
      campaign.target_role,
      campaign.company_sizes
    );

    if (!contact || !contact.email) continue;

    await supabaseAdmin.from('prospects').insert({
      company_id: campaign.company_id,
      assigned_user_id: campaign.assigned_user_id,
      prospect_company_id: prospectCompany.id,
      full_name: contact.full_name || 'Contact à identifier',
      email: contact.email,
      phone: contact.phone,
      job_title: contact.job_title,
      linkedin_url: contact.linkedin_url,
      status: 'jaune',
      // Docx pipeline "Réactivation" (Alex, 2026-08-23) : ce prospect a été
      // trouvé et démarché de A à Z par Aaron (campagne de prospection),
      // contrairement à un ajout manuel/CSV du commercial ou une
      // réactivation — voir migration_reactivation_2026-08-23.sql.
      origin: 'amene_par_aaron',
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
