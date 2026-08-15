// lib/crm-sync.ts
// Socle de synchronisation CRM — pousse les prospects gagnés vers HubSpot
// (contact + deal). Volontairement PAS câblé à un déclencheur automatique
// (ex: dès qu'un prospect passe "gagné") : sans connexion HubSpot réelle
// testée en conditions réelles (aucun compte de test HubSpot disponible dans
// cette session), un déclenchement automatique en tâche de fond aurait pu
// échouer silencieusement pendant des jours sans que personne ne le remarque.
// Exposé à la place via un bouton "Synchroniser maintenant" dans Préférences
// (app/api/crm-connections/sync) — déclenché à la demande, résultat visible
// immédiatement, sans risque de dérive silencieuse.

import { supabaseAdmin } from './supabase-admin';
import { encryptToken, decryptToken } from './encryption';

interface CrmConnection {
  id: string;
  company_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

async function getValidHubspotAccessToken(companyId: string): Promise<string> {
  const { data: connection, error } = await supabaseAdmin
    .from('crm_connections')
    .select('*')
    .eq('company_id', companyId)
    .eq('provider', 'hubspot')
    .single<CrmConnection>();

  if (error || !connection) {
    throw new Error(`Aucune connexion HubSpot trouvée pour la société ${companyId}`);
  }

  const isExpired = !connection.expires_at || new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (!isExpired) {
    return decryptToken(connection.access_token);
  }

  if (!connection.refresh_token) {
    throw new Error('Token HubSpot expiré et aucun refresh_token disponible — reconnexion nécessaire dans Préférences.');
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
export async function syncWonProspectToHubspot(companyId: string, prospect: {
  id: string;
  full_name: string | null;
  email: string;
  job_title: string | null;
  prospect_companies?: { name: string | null } | null;
}): Promise<{ contact_id: string; deal_id: string | null }> {
  const accessToken = await getValidHubspotAccessToken(companyId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // 1. Upsert contact par email (endpoint HubSpot dédié — évite de chercher
  // puis créer/mettre à jour en deux appels séparés).
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
    // N'existe pas encore -> création
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

  // 2. Crée une deal "Signé" et l'associe au contact — best-effort : un
  // prospect synchronisé sans deal reste utile (le contact existe), donc une
  // erreur ici n'annule pas la synchronisation du contact déjà réussie.
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

  await supabaseAdmin.from('prospects').update({ crm_synced_at: new Date().toISOString() }).eq('id', prospect.id);

  return { contact_id: contactId, deal_id: dealId };
}
