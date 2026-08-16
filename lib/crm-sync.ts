// lib/crm-sync.ts
// Socle de synchronisation CRM — pousse les prospects gagnés vers le CRM
// connecté (contact + deal/opportunité). Volontairement PAS câblé à un
// déclencheur automatique (ex: dès qu'un prospect passe "gagné") : sans
// connexion réelle testée en conditions réelles pour chaque CRM, un
// déclenchement automatique en tâche de fond aurait pu échouer silencieusement
// pendant des jours sans que personne ne le remarque. Exposé à la place via un
// bouton "Synchroniser maintenant" dans Connexions (app/api/crm-connections/sync)
// — déclenché à la demande, résultat visible immédiatement, sans risque de
// dérive silencieuse.
//
// CHANGEMENTS A FAIRE (2026-08-16) : ajout de Salesforce et Pipedrive à côté
// de HubSpot, même logique de synchronisation (upsert contact + deal "gagnée"),
// adaptée aux API de chacun. `syncWonProspectToCrm` est le point d'entrée
// générique utilisé par app/api/crm-connections/sync/route.ts — il regarde
// quel provider est connecté et appelle la bonne fonction.

import { supabaseAdmin } from './supabase-admin';
import { encryptToken, decryptToken } from './encryption';

interface CrmConnection {
  id: string;
  company_id: string;
  provider: string;
  portal_id: string | null;
  instance_url: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

interface WonProspect {
  id: string;
  full_name: string | null;
  email: string;
  job_title: string | null;
  prospect_companies?: { name: string | null } | null;
}

async function getConnection(companyId: string, provider: string): Promise<CrmConnection> {
  const { data: connection, error } = await supabaseAdmin
    .from('crm_connections')
    .select('*')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .single<CrmConnection>();

  if (error || !connection) {
    throw new Error(`Aucune connexion ${provider} trouvée pour la société ${companyId}`);
  }
  return connection;
}

// ---------------------------------------------------------------------------
// HubSpot
// ---------------------------------------------------------------------------

async function getValidHubspotAccessToken(companyId: string): Promise<string> {
  const connection = await getConnection(companyId, 'hubspot');

  const isExpired = !connection.expires_at || new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (!isExpired) {
    return decryptToken(connection.access_token);
  }

  if (!connection.refresh_token) {
    throw new Error('Token HubSpot expiré et aucun refresh_token disponible — reconnexion nécessaire dans Connexions.');
  }

  const refreshToken = decryptToken(connection.refresh_token);
  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID!,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Erreur rafraîchissement token HubSpot: ${errBody}`);
  }

  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from('crm_connections')
    .update({
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : connection.refresh_token,
      expires_at: expiresAt,
    })
    .eq('id', connection.id);

  return tokens.access_token;
}

// Crée ou met à jour (par email, l'identifiant naturel HubSpot pour un contact)
// un contact + une deal associée "Signé" — appelé UN prospect à la fois par
// app/api/crm-connections/sync/route.ts, jamais en masse depuis un cron.
async function syncWonProspectToHubspot(companyId: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const accessToken = await getValidHubspotAccessToken(companyId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const contactRes = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(prospect.email)}?idProperty=email`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        properties: {
          email: prospect.email,
          firstname: firstName || '',
          lastname: rest.join(' '),
          jobtitle: prospect.job_title || '',
          company: prospect.prospect_companies?.name || '',
        },
      }),
    }
  );

  let contactId: string;
  if (contactRes.status === 404) {
    const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        properties: {
          email: prospect.email,
          firstname: firstName || '',
          lastname: rest.join(' '),
          jobtitle: prospect.job_title || '',
          company: prospect.prospect_companies?.name || '',
        },
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Erreur création contact HubSpot: ${await createRes.text()}`);
    }
    const created = await createRes.json();
    contactId = created.id;
  } else if (contactRes.ok) {
    const updated = await contactRes.json();
    contactId = updated.id;
  } else {
    throw new Error(`Erreur mise à jour contact HubSpot: ${await contactRes.text()}`);
  }

  let dealId: string | null = null;
  try {
    const dealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        properties: {
          dealname: `${prospect.full_name || prospect.email} — ${prospect.prospect_companies?.name || 'Meet Aaron'}`,
          dealstage: 'closedwon',
        },
        associations: [
          {
            to: { id: contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
          },
        ],
      }),
    });
    if (dealRes.ok) {
      const deal = await dealRes.json();
      dealId = deal.id;
    } else {
      console.error('Erreur création deal HubSpot (contact synchronisé quand même):', await dealRes.text());
    }
  } catch (err) {
    console.error('Erreur création deal HubSpot (contact synchronisé quand même):', err);
  }

  return { contact_id: contactId, deal_id: dealId };
}

// ---------------------------------------------------------------------------
// Salesforce
// ---------------------------------------------------------------------------

// Salesforce ne renvoie pas de date d'expiration fixe à l'échange du token
// (contrairement à HubSpot/Pipedrive) — on utilise donc le token stocké tel
// quel, et on ne rafraîchit qu'en réaction à un 401 réel de l'API (voir
// syncWonProspectToSalesforce ci-dessous), plutôt que de deviner une durée.
async function refreshSalesforceToken(connection: CrmConnection): Promise<{ accessToken: string; instanceUrl: string }> {
  if (!connection.refresh_token) {
    throw new Error('Token Salesforce expiré et aucun refresh_token disponible — reconnexion nécessaire dans Connexions.');
  }
  const refreshToken = decryptToken(connection.refresh_token);
  const response = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Erreur rafraîchissement token Salesforce: ${errBody}`);
  }

  const tokens = await response.json();

  await supabaseAdmin
    .from('crm_connections')
    .update({
      access_token: encryptToken(tokens.access_token),
      instance_url: tokens.instance_url || connection.instance_url,
    })
    .eq('id', connection.id);

  return { accessToken: tokens.access_token, instanceUrl: tokens.instance_url || connection.instance_url! };
}

// Upsert contact + Opportunity "Closed Won" (l'équivalent Salesforce d'une
// deal HubSpot signée) via l'API REST Salesforce (sobject Contact/Opportunity).
async function syncWonProspectToSalesforce(companyId: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const connection = await getConnection(companyId, 'salesforce');
  if (!connection.instance_url) {
    throw new Error('instance_url Salesforce manquante — reconnexion nécessaire dans Connexions.');
  }

  let accessToken = decryptToken(connection.access_token);
  let instanceUrl = connection.instance_url;

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const lastName = rest.join(' ') || firstName || prospect.email;

  async function apiCall(path: string, init: RequestInit): Promise<Response> {
    let res = await fetch(`${instanceUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      // Token expiré côté Salesforce (aucune date d'expiration connue à
      // l'avance côté Meet Aaron) — on rafraîchit une fois et on retente.
      const refreshed = await refreshSalesforceToken(connection);
      accessToken = refreshed.accessToken;
      instanceUrl = refreshed.instanceUrl;
      res = await fetch(`${instanceUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
      });
    }
    return res;
  }

  // Recherche par email via SOQL (identifiant naturel, comme pour HubSpot).
  const soql = `SELECT Id FROM Contact WHERE Email = '${prospect.email.replace(/'/g, "\\'")}' LIMIT 1`;
  const searchRes = await apiCall(`/services/data/v59.0/query?q=${encodeURIComponent(soql)}`, { method: 'GET' });
  if (!searchRes.ok) {
    throw new Error(`Erreur recherche contact Salesforce: ${await searchRes.text()}`);
  }
  const searchBody = await searchRes.json();
  const existingId: string | null = searchBody.records?.[0]?.Id || null;

  const contactFields = {
    Email: prospect.email,
    FirstName: firstName || '',
    LastName: lastName,
    Title: prospect.job_title || '',
  };

  let contactId: string;
  if (existingId) {
    const updateRes = await apiCall(`/services/data/v59.0/sobjects/Contact/${existingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactFields),
    });
    if (!updateRes.ok && updateRes.status !== 204) {
      throw new Error(`Erreur mise à jour contact Salesforce: ${await updateRes.text()}`);
    }
    contactId = existingId;
  } else {
    const createRes = await apiCall('/services/data/v59.0/sobjects/Contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactFields),
    });
    if (!createRes.ok) {
      throw new Error(`Erreur création contact Salesforce: ${await createRes.text()}`);
    }
    const created = await createRes.json();
    contactId = created.id;
  }

  // Opportunity "Closed Won" — best-effort, comme pour la deal HubSpot : un
  // contact synchronisé sans opportunité reste utile.
  let dealId: string | null = null;
  try {
    const oppRes = await apiCall('/services/data/v59.0/sobjects/Opportunity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Name: `${prospect.full_name || prospect.email} — ${prospect.prospect_companies?.name || 'Meet Aaron'}`,
        StageName: 'Closed Won',
        CloseDate: new Date().toISOString().slice(0, 10),
        ContactId: contactId,
      }),
    });
    if (oppRes.ok) {
      const opp = await oppRes.json();
      dealId = opp.id;
    } else {
      console.error('Erreur création Opportunity Salesforce (contact synchronisé quand même):', await oppRes.text());
    }
  } catch (err) {
    console.error('Erreur création Opportunity Salesforce (contact synchronisé quand même):', err);
  }

  return { contact_id: contactId, deal_id: dealId };
}

// ---------------------------------------------------------------------------
// Pipedrive
// ---------------------------------------------------------------------------

async function getValidPipedriveAccessToken(companyId: string): Promise<{ accessToken: string; apiDomain: string }> {
  const connection = await getConnection(companyId, 'pipedrive');
  if (!connection.instance_url) {
    throw new Error('api_domain Pipedrive manquant — reconnexion nécessaire dans Connexions.');
  }

  const isExpired = !connection.expires_at || new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (!isExpired) {
    return { accessToken: decryptToken(connection.access_token), apiDomain: connection.instance_url };
  }

  if (!connection.refresh_token) {
    throw new Error('Token Pipedrive expiré et aucun refresh_token disponible — reconnexion nécessaire dans Connexions.');
  }

  const refreshToken = decryptToken(connection.refresh_token);
  const response = await fetch('https://oauth.pipedrive.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.PIPEDRIVE_CLIENT_ID}:${process.env.PIPEDRIVE_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Erreur rafraîchissement token Pipedrive: ${errBody}`);
  }

  const tokens = await response.json();
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
  const apiDomain = tokens.api_domain || connection.instance_url;

  await supabaseAdmin
    .from('crm_connections')
    .update({
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : connection.refresh_token,
      expires_at: expiresAt,
      instance_url: apiDomain,
    })
    .eq('id', connection.id);

  return { accessToken: tokens.access_token, apiDomain };
}

// Upsert personne (contact) + deal "gagnée" via l'API Pipedrive v1.
async function syncWonProspectToPipedrive(companyId: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const { accessToken, apiDomain } = await getValidPipedriveAccessToken(companyId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Recherche par email — endpoint de recherche dédié Pipedrive (items de type "person").
  const searchRes = await fetch(
    `${apiDomain}/api/v1/persons/search?term=${encodeURIComponent(prospect.email)}&fields=email&exact_match=true`,
    { headers }
  );
  if (!searchRes.ok) {
    throw new Error(`Erreur recherche contact Pipedrive: ${await searchRes.text()}`);
  }
  const searchBody = await searchRes.json();
  const existingId: number | null = searchBody.data?.items?.[0]?.item?.id || null;

  const personFields = {
    name: prospect.full_name || prospect.email,
    email: [{ value: prospect.email, primary: true }],
    job_title: prospect.job_title || undefined,
    org_name: prospect.prospect_companies?.name || undefined,
  };

  let personId: number;
  if (existingId) {
    const updateRes = await fetch(`${apiDomain}/api/v1/persons/${existingId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(personFields),
    });
    if (!updateRes.ok) {
      throw new Error(`Erreur mise à jour contact Pipedrive: ${await updateRes.text()}`);
    }
    personId = existingId;
  } else {
    const createRes = await fetch(`${apiDomain}/api/v1/persons`, {
      method: 'POST',
      headers,
      body: JSON.stringify(personFields),
    });
    if (!createRes.ok) {
      throw new Error(`Erreur création contact Pipedrive: ${await createRes.text()}`);
    }
    const created = await createRes.json();
    personId = created.data.id;
  }

  // Deal "won" — best-effort, comme pour HubSpot/Salesforce.
  let dealId: number | null = null;
  try {
    const dealRes = await fetch(`${apiDomain}/api/v1/deals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `${prospect.full_name || prospect.email} — ${prospect.prospect_companies?.name || 'Meet Aaron'}`,
        person_id: personId,
        status: 'won',
      }),
    });
    if (dealRes.ok) {
      const deal = await dealRes.json();
      dealId = deal.data.id;
    } else {
      console.error('Erreur création deal Pipedrive (contact synchronisé quand même):', await dealRes.text());
    }
  } catch (err) {
    console.error('Erreur création deal Pipedrive (contact synchronisé quand même):', err);
  }

  return { contact_id: String(personId), deal_id: dealId !== null ? String(dealId) : null };
}

// ---------------------------------------------------------------------------
// Axonaut
// ---------------------------------------------------------------------------

// Axonaut n'a pas de flux OAuth : la connexion (app/api/crm-connections/axonaut)
// stocke directement une clé API statique chiffrée dans access_token, sans
// refresh_token ni expires_at (voir ce fichier). Header d'authentification et
// base URL confirmés auprès de la documentation officielle Axonaut (icône clé
// à molette -> API dans l'interface) et du code source ouvert d'intégrations
// tierces (paquet R ThinkR-open/axonaut, nœud n8n Axonaut) — pas de sandbox
// disponible pour tester en conditions réelles, donc chaque appel reste
// défensif (recherche client-side, best-effort sur l'opportunité).
const AXONAUT_BASE_URL = 'https://axonaut.com/api/v2';

// Contrairement à HubSpot/Salesforce/Pipedrive, Axonaut modélise une société
// (companies) et une personne (employees, rattachée à une société via
// company_id) comme deux ressources distinctes plutôt qu'un simple "contact".
// Pas d'endpoint de recherche documenté pour les sociétés : on liste puis on
// filtre côté client (comportement déjà utilisé par le paquet R officieux).
// Les employés supportent en revanche un filtre serveur par email.
async function syncWonProspectToAxonaut(companyId: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const connection = await getConnection(companyId, 'axonaut');
  const apiKey = decryptToken(connection.access_token);
  const headers = {
    userApiKey: apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const axonautCompanyName = prospect.prospect_companies?.name || prospect.full_name || prospect.email;

  let axonautCompanyId: number | null = null;
  const listRes = await fetch(`${AXONAUT_BASE_URL}/companies`, { headers });
  if (listRes.ok) {
    const companies = await listRes.json();
    const match = Array.isArray(companies)
      ? companies.find((c: any) => (c.name || '').toLowerCase() === axonautCompanyName.toLowerCase())
      : null;
    if (match) axonautCompanyId = match.id;
  } else {
    console.error('Erreur listage sociétés Axonaut (on tentera quand même une création):', await listRes.text());
  }

  if (!axonautCompanyId) {
    const createCompanyRes = await fetch(`${AXONAUT_BASE_URL}/companies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: axonautCompanyName }),
    });
    if (!createCompanyRes.ok) {
      throw new Error(`Erreur création société Axonaut: ${await createCompanyRes.text()}`);
    }
    const createdCompany = await createCompanyRes.json();
    axonautCompanyId = createdCompany.id;
  }

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const lastName = rest.join(' ');

  const searchRes = await fetch(`${AXONAUT_BASE_URL}/employees?email=${encodeURIComponent(prospect.email)}`, { headers });
  let existingEmployeeId: number | null = null;
  if (searchRes.ok) {
    const found = await searchRes.json();
    const match = Array.isArray(found)
      ? found.find((e: any) => (e.email || '').toLowerCase() === prospect.email.toLowerCase())
      : null;
    if (match) existingEmployeeId = match.id;
  }

  const employeeFields = {
    firstname: firstName || prospect.email,
    lastname: lastName || '',
    email: prospect.email,
    position: prospect.job_title || '',
    company_id: axonautCompanyId,
  };

  let employeeId: number;
  if (existingEmployeeId) {
    const updateRes = await fetch(`${AXONAUT_BASE_URL}/employees/${existingEmployeeId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(employeeFields),
    });
    if (!updateRes.ok) {
      throw new Error(`Erreur mise à jour contact Axonaut: ${await updateRes.text()}`);
    }
    employeeId = existingEmployeeId;
  } else {
    const createEmployeeRes = await fetch(`${AXONAUT_BASE_URL}/employees`, {
      method: 'POST',
      headers,
      body: JSON.stringify(employeeFields),
    });
    if (!createEmployeeRes.ok) {
      throw new Error(`Erreur création contact Axonaut: ${await createEmployeeRes.text()}`);
    }
    const createdEmployee = await createEmployeeRes.json();
    employeeId = createdEmployee.id;
  }

  // Opportunité "gagnée" — best-effort comme pour les autres CRM. On évite de
  // deviner un pipe/step spécifique au compte Axonaut d'Alex (propre à chaque
  // compte, non standardisé) en créant l'opportunité sans étape imposée puis
  // en la marquant gagnée via l'endpoint dédié PATCH /opportunities/{id}/won
  // (sans corps), qui gère la transition de pipeline lui-même.
  let dealId: string | null = null;
  try {
    const oppRes = await fetch(`${AXONAUT_BASE_URL}/opportunities`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        company_id: axonautCompanyId,
        name: `${prospect.full_name || prospect.email} — ${prospect.prospect_companies?.name || 'Meet Aaron'}`,
      }),
    });
    if (oppRes.ok) {
      const opp = await oppRes.json();
      dealId = opp?.id != null ? String(opp.id) : null;
      if (dealId) {
        const wonRes = await fetch(`${AXONAUT_BASE_URL}/opportunities/${dealId}/won`, {
          method: 'PATCH',
          headers,
          body: '{}',
        });
        if (!wonRes.ok) {
          console.error('Erreur marquage "gagnée" opportunité Axonaut (créée quand même):', await wonRes.text());
        }
      }
    } else {
      console.error('Erreur création opportunité Axonaut (contact synchronisé quand même):', await oppRes.text());
    }
  } catch (err) {
    console.error('Erreur opportunité Axonaut (contact synchronisé quand même):', err);
  }

  return { contact_id: String(employeeId), deal_id: dealId };
}

// ---------------------------------------------------------------------------
// Sellsy
// ---------------------------------------------------------------------------

// Sellsy utilise OAuth2 "client credentials" (troisième architecture
// distincte, ni redirection utilisateur comme HubSpot/Salesforce/Pipedrive,
// ni clé API unique comme Axonaut) : un identifiant client_id + client_secret
// créé dans Sellsy (Réglages -> Developer Portal -> API V2 -> "Créer un accès
// API"), échangé contre un jeton d'accès de courte durée à chaque utilisation.
// Endpoint et grant_type confirmés via la doc d'aide Sellsy et le client PHP
// open source officieux Hydrat-Agency/Sellsy-Client (source de vérité la plus
// concrète, la doc Swagger officielle étant en JS non exploitable en fetch
// direct). On ne met pas en cache le jeton lui-même (pas de colonne dédiée) :
// client_id et client_secret chiffrés sont stockés dans access_token/
// refresh_token (réutilisation de ces colonnes, comme Axonaut réutilise
// access_token pour sa clé statique), et un nouveau jeton est redemandé à
// chaque synchronisation — un appel de plus par synchronisation manuelle,
// sans conséquence pratique.
const SELLSY_TOKEN_URL = 'https://login.sellsy.com/oauth2/access-tokens';
const SELLSY_API_URL = 'https://api.sellsy.com/v2';

async function getSellsyAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(SELLSY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Erreur authentification Sellsy: ${errBody}`);
  }
  const tokens = await response.json();
  return tokens.access_token;
}

// Sellsy sépare "société" (companies) et "contact" (contacts), reliés par un
// lien explicite POST /companies/{id}/contacts/{contactId} plutôt qu'un
// company_id direct sur le contact — confirmé via deux clients PHP open
// source indépendants (Hydrat-Agency/Sellsy-Client, bluerocktel/sellsy-
// client). Pas de recherche serveur documentée par nom/email dans ces deux
// sources : filtre côté client sur le listing, même approche défensive que
// pour Axonaut (pas de compte réel disponible pour vérifier un éventuel
// paramètre de recherche serveur). Pour l'opportunité, aucune des sources
// consultées ne documente d'identifiant de pipeline/étape "gagné" par défaut
// — plutôt que de deviner un step_id propre au compte Sellsy d'Alex (risque
// de la créer dans la mauvaise étape du pipeline), on crée l'opportunité
// liée à la société sans forcer de statut : elle apparaît dans Sellsy pour
// être glissée en "Gagné" manuellement, ou l'automatisation complète sera
// ajoutée dès qu'un compte réel permettra de confirmer le champ exact.
async function syncWonProspectToSellsy(companyId: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const connection = await getConnection(companyId, 'sellsy');
  const clientId = decryptToken(connection.access_token);
  const clientSecret = connection.refresh_token ? decryptToken(connection.refresh_token) : null;
  if (!clientSecret) {
    throw new Error('Identifiants Sellsy incomplets — reconnexion nécessaire dans Connexions.');
  }
  const accessToken = await getSellsyAccessToken(clientId, clientSecret);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const sellsyCompanyName = prospect.prospect_companies?.name || prospect.full_name || prospect.email;

  let sellsyCompanyId: number | null = null;
  const listRes = await fetch(`${SELLSY_API_URL}/companies`, { headers });
  if (listRes.ok) {
    const listBody = await listRes.json();
    const items = Array.isArray(listBody?.data) ? listBody.data : Array.isArray(listBody) ? listBody : [];
    const match = items.find((c: any) => (c.name || '').toLowerCase() === sellsyCompanyName.toLowerCase());
    if (match) sellsyCompanyId = match.id;
  } else {
    console.error('Erreur listage sociétés Sellsy (on tentera quand même une création):', await listRes.text());
  }

  if (!sellsyCompanyId) {
    const createCompanyRes = await fetch(`${SELLSY_API_URL}/companies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: sellsyCompanyName }),
    });
    if (!createCompanyRes.ok) {
      throw new Error(`Erreur création société Sellsy: ${await createCompanyRes.text()}`);
    }
    const createdCompany = await createCompanyRes.json();
    sellsyCompanyId = createdCompany.id;
  }

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const lastName = rest.join(' ');

  let existingContactId: number | null = null;
  const searchRes = await fetch(`${SELLSY_API_URL}/contacts`, { headers });
  if (searchRes.ok) {
    const searchBody = await searchRes.json();
    const items = Array.isArray(searchBody?.data) ? searchBody.data : Array.isArray(searchBody) ? searchBody : [];
    const match = items.find((c: any) => (c.email || '').toLowerCase() === prospect.email.toLowerCase());
    if (match) existingContactId = match.id;
  }

  const contactFields = {
    first_name: firstName || prospect.email,
    last_name: lastName || '',
    email: prospect.email,
    position: prospect.job_title || '',
  };

  let contactId: number;
  if (existingContactId) {
    const updateRes = await fetch(`${SELLSY_API_URL}/contacts/${existingContactId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(contactFields),
    });
    if (!updateRes.ok) {
      throw new Error(`Erreur mise à jour contact Sellsy: ${await updateRes.text()}`);
    }
    contactId = existingContactId;
  } else {
    const createContactRes = await fetch(`${SELLSY_API_URL}/contacts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(contactFields),
    });
    if (!createContactRes.ok) {
      throw new Error(`Erreur création contact Sellsy: ${await createContactRes.text()}`);
    }
    const createdContact = await createContactRes.json();
    contactId = createdContact.id;
  }

  // Lien contact <-> société — ressource distincte côté Sellsy (pas de
  // company_id direct sur le contact), best-effort : un contact non lié
  // reste utile tel quel.
  try {
    const linkRes = await fetch(`${SELLSY_API_URL}/companies/${sellsyCompanyId}/contacts/${contactId}`, {
      method: 'POST',
      headers,
    });
    if (!linkRes.ok) {
      console.error('Erreur liaison contact/société Sellsy (contact créé quand même):', await linkRes.text());
    }
  } catch (err) {
    console.error('Erreur liaison contact/société Sellsy (contact créé quand même):', err);
  }

  // Opportunité — best-effort, sans statut forcé (voir commentaire ci-dessus).
  let dealId: string | null = null;
  try {
    const oppRes = await fetch(`${SELLSY_API_URL}/opportunities`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `${prospect.full_name || prospect.email} — ${prospect.prospect_companies?.name || 'Meet Aaron'}`,
        related: [{ id: sellsyCompanyId, type: 'company' }],
      }),
    });
    if (oppRes.ok) {
      const opp = await oppRes.json();
      dealId = opp?.id != null ? String(opp.id) : null;
    } else {
      console.error('Erreur création opportunité Sellsy (contact synchronisé quand même):', await oppRes.text());
    }
  } catch (err) {
    console.error('Erreur opportunité Sellsy (contact synchronisé quand même):', err);
  }

  return { contact_id: String(contactId), deal_id: dealId };
}

// ---------------------------------------------------------------------------
// Jobber
// ---------------------------------------------------------------------------

// Jobber utilise OAuth2 classique à redirection utilisateur (comme HubSpot/
// Salesforce/Pipedrive — voir app/api/auth/jobber), mais son API est
// GraphQL, pas REST : une seule URL (POST) pour toutes les opérations,
// confirmé via la doc officielle developer.getjobber.com. Chaque requête doit
// inclure l'en-tête `X-JOBBER-GRAPHQL-VERSION` (version figée ci-dessous —
// à surveiller si Jobber déprécie cette version, voir leur changelog).
const JOBBER_API_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const JOBBER_GRAPHQL_VERSION = '2025-04-16';

async function getValidJobberAccessToken(companyId: string): Promise<string> {
  const connection = await getConnection(companyId, 'jobber');

  const isExpired = !connection.expires_at || new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (!isExpired) {
    return decryptToken(connection.access_token);
  }

  if (!connection.refresh_token) {
    throw new Error('Token Jobber expiré et aucun refresh_token disponible — reconnexion nécessaire dans Connexions.');
  }

  const refreshToken = decryptToken(connection.refresh_token);
  const response = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.JOBBER_CLIENT_ID!,
      client_secret: process.env.JOBBER_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Erreur rafraîchissement token Jobber: ${errBody}`);
  }

  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from('crm_connections')
    .update({
      access_token: encryptToken(tokens.access_token),
      // Rotation du refresh_token possible côté Jobber ("Refresh Token
      // Rotation") — si un nouveau refresh_token est renvoyé, on le stocke ;
      // sinon on garde l'ancien.
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : connection.refresh_token,
      expires_at: expiresAt,
    })
    .eq('id', connection.id);

  return tokens.access_token;
}

async function jobberGraphql(accessToken: string, query: string, variables: Record<string, any>): Promise<any> {
  const res = await fetch(JOBBER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_GRAPHQL_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Erreur requête GraphQL Jobber (HTTP ${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`Erreur GraphQL Jobber: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

// Jobber modélise un "client" (personne + société combinées, pas d'entité
// séparée), confirmé via la doc officielle (mutation `clientCreate`, champs
// firstName/lastName/companyName/emails). Pas de champ de recherche serveur
// par email documenté dans les sources consultées (doc officielle + modèle
// d'app Rails GetJobber/Jobber-AppTemplate-RailsAPI, qui ne montre qu'une
// liste paginée sans filtre email) : recherche défensive côté client sur les
// 100 premiers clients, même approche qu'Axonaut/Sellsy. Si un client
// existant est trouvé par email, on le réutilise TEL QUEL sans tenter de le
// mettre à jour — le nom de la mutation de modification n'a pas pu être
// confirmé avec certitude (probablement `clientEdit`, par analogie avec
// `clientNoteEdit`/`jobNoteEdit` vus dans le changelog officiel, mais jamais
// vérifié contre un compte réel) : plutôt que de deviner et risquer un appel
// qui échoue silencieusement mal, on se contente de réutiliser l'ID trouvé.
//
// **Limite assumée** : aucune opportunité/devis n'est créé côté Jobber — le
// concept le plus proche (`quoteCreate`/`jobCreate`) n'a pas de schéma de
// champs confirmé dans la documentation publique consultée. Seul le client
// est synchronisé. À enrichir dès qu'un compte Jobber réel permet de confirmer
// les mutations Devis/Job exactes.
async function syncWonProspectToJobber(companyId: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const accessToken = await getValidJobberAccessToken(companyId);

  const listQuery = `
    query {
      clients(first: 100) {
        nodes {
          id
          emails { address }
        }
      }
    }
  `;
  let existingClientId: string | null = null;
  try {
    const listData = await jobberGraphql(accessToken, listQuery, {});
    const match = (listData?.clients?.nodes || []).find((c: any) =>
      (c.emails || []).some((e: any) => (e.address || '').toLowerCase() === prospect.email.toLowerCase())
    );
    if (match) existingClientId = match.id;
  } catch (err) {
    console.error('Erreur listage clients Jobber (on tentera quand même une création):', err);
  }

  if (existingClientId) {
    return { contact_id: existingClientId, deal_id: null };
  }

  const [firstName, ...rest] = (prospect.full_name || '').split(' ');
  const lastName = rest.join(' ') || prospect.email;

  const createMutation = `
    mutation ClientCreate($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client { id }
        userErrors { message path }
      }
    }
  `;
  const createData = await jobberGraphql(accessToken, createMutation, {
    input: {
      firstName: firstName || prospect.email,
      lastName,
      companyName: prospect.prospect_companies?.name || undefined,
      emails: [{ description: 'MAIN', primary: true, address: prospect.email }],
    },
  });

  if (createData?.clientCreate?.userErrors?.length) {
    throw new Error(`Erreur création client Jobber: ${JSON.stringify(createData.clientCreate.userErrors)}`);
  }

  const clientId = createData?.clientCreate?.client?.id;
  if (!clientId) {
    throw new Error('Création client Jobber: aucun id retourné');
  }

  return { contact_id: clientId, deal_id: null };
}

// ---------------------------------------------------------------------------
// Point d'entrée générique
// ---------------------------------------------------------------------------

const SYNC_BY_PROVIDER: Record<string, (companyId: string, prospect: WonProspect) => Promise<{ contact_id: string; deal_id: string | null }>> = {
  hubspot: syncWonProspectToHubspot,
  salesforce: syncWonProspectToSalesforce,
  pipedrive: syncWonProspectToPipedrive,
  axonaut: syncWonProspectToAxonaut,
  sellsy: syncWonProspectToSellsy,
  jobber: syncWonProspectToJobber,
};

export async function syncWonProspectToCrm(companyId: string, provider: string, prospect: WonProspect): Promise<{ contact_id: string; deal_id: string | null }> {
  const syncFn = SYNC_BY_PROVIDER[provider];
  if (!syncFn) {
    throw new Error(`Synchronisation non supportée pour le provider "${provider}"`);
  }
  const result = await syncFn(companyId, prospect);
  await supabaseAdmin.from('prospects').update({ crm_synced_at: new Date().toISOString() }).eq('id', prospect.id);
  return result;
}
