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
// Point d'entrée générique
// ---------------------------------------------------------------------------

const SYNC_BY_PROVIDER: Record<string, (companyId: string, prospect: WonProspect) => Promise<{ contact_id: string; deal_id: string | null }>> = {
  hubspot: syncWonProspectToHubspot,
  salesforce: syncWonProspectToSalesforce,
  pipedrive: syncWonProspectToPipedrive,
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
