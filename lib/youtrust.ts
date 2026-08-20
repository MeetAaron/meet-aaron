// lib/youtrust.ts
// Intégration signature électronique (docx "OPPORTUNITES A4" : "tu me mets
// en place yousign ? fais le merci"). Yousign a changé de nom pour Youtrust
// en 2026 — même produit, même API v3, seul le nom de domaine change. Voir
// https://developers.youtrust.com pour la doc officielle.
//
// Flux (API v3, confirmé sur la doc publique) :
//   1. POST /signature_requests                                  -> crée la demande (statut "draft")
//   2. POST /signature_requests/{id}/documents  (multipart/form-data) -> attache le PDF
//   3. POST /signature_requests/{id}/signers                     -> ajoute le prospect comme signataire + place le champ signature
//   4. POST /signature_requests/{id}/activate                    -> lance réellement l'envoi (statut "ongoing")
// La réponse de l'étape 3 contient le lien de signature du signataire.
//
// Environnements (voir developers.youtrust.com/docs/environments-new) :
//   - Sandbox (par défaut ici, tant que YOUTRUST_API_BASE n'est pas défini) :
//     https://api-sandbox.yousign.app/v3 — clé API sandbox, aucun email réel
//     envoyé au prospect, utile pour valider le flux avant la mise en prod.
//   - Production : https://api.yousign.app/v3 — nécessite un abonnement payant
//     (au-delà de l'essai gratuit) et une clé API "production" distincte.
// Alex doit définir YOUTRUST_API_KEY (et éventuellement YOUTRUST_API_BASE
// pour passer en production) dans Vercel — voir .env.example. Tant que
// YOUTRUST_API_KEY n'est pas renseignée, toute tentative d'envoi échoue avec
// un message clair côté UI (voir app/api/prospects/[id]/signature-request),
// le reste de l'app continue de fonctionner normalement (repli possible sur
// le lien collé manuellement, resté inchangé).
//
// IMPORTANT — non testé en conditions réelles : cette intégration a été
// écrite à partir de la documentation publique Youtrust, sans clé API pour
// la valider en conditions réelles (voir contrainte : aucun accès direct à
// des identifiants/API keys tiers pour ce projet). Alex doit tester le
// bouton "Envoyer via signature électronique" une première fois en sandbox
// avant de considérer cette fonctionnalité fiable en production.

const DEFAULT_BASE_URL = 'https://api-sandbox.yousign.app/v3';

function apiBase(): string {
  return process.env.YOUTRUST_API_BASE?.trim() || DEFAULT_BASE_URL;
}

function apiKey(): string {
  const key = process.env.YOUTRUST_API_KEY;
  if (!key) {
    throw new Error(
      "Signature électronique non configurée — la variable d'environnement YOUTRUST_API_KEY est manquante (à ajouter dans Vercel par Alex)."
    );
  }
  return key;
}

async function youtrustFetch(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non-JSON (rare, ex: erreur gateway) — on garde le texte brut pour le message d'erreur.
  }

  if (!res.ok) {
    const message = json?.detail || json?.message || text || `Erreur HTTP ${res.status}`;
    throw new Error(`Youtrust: ${message}`);
  }

  return json;
}

interface CreateSignatureRequestParams {
  requestName: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
  signerFirstName: string;
  signerLastName: string;
  signerEmail: string;
  locale?: string;
}

interface SignatureRequestResult {
  signatureRequestId: string;
  signerId: string;
  signatureLink: string;
}

// Youtrust attend une locale parmi une liste fermée — on ramène toute langue
// non supportée sur l'anglais plutôt que de risquer un rejet de l'appel.
const YOUTRUST_LOCALES = new Set(['fr', 'en', 'es', 'it', 'de', 'pt', 'nl']);
function toYoutrustLocale(locale?: string): string {
  const short = (locale || 'fr').slice(0, 2).toLowerCase();
  return YOUTRUST_LOCALES.has(short) ? short : 'en';
}

// Place le champ de signature en bas à droite de la dernière page connue —
// faute de savoir combien de pages compte le PDF final avant l'upload, on
// demande la position sur la page 1 : suffisant pour un devis court (1-2
// pages, cas normal ici), le signataire peut de toute façon déplacer le
// champ dans l'interface Youtrust si besoin.
export async function createSignatureRequest(params: CreateSignatureRequestParams): Promise<SignatureRequestResult> {
  const created = await youtrustFetch('/signature_requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: params.requestName, delivery_mode: 'email' }),
  });

  const signatureRequestId = created.id;
  if (!signatureRequestId) {
    throw new Error('Youtrust: réponse de création de la demande de signature invalide (id manquant).');
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(params.pdfBuffer)], { type: 'application/pdf' }), params.pdfFilename);
  form.append('nature', 'signable_document');

  const document = await youtrustFetch(`/signature_requests/${signatureRequestId}/documents`, {
    method: 'POST',
    body: form,
  });

  const documentId = document.id;
  if (!documentId) {
    throw new Error('Youtrust: réponse d\'upload du document invalide (id manquant).');
  }

  const signer = await youtrustFetch(`/signature_requests/${signatureRequestId}/signers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      info: {
        first_name: params.signerFirstName,
        last_name: params.signerLastName || params.signerFirstName,
        email: params.signerEmail,
        locale: toYoutrustLocale(params.locale),
      },
      signature_level: 'electronic_signature',
      signature_authentication_mode: 'no_otp',
      fields: [{ type: 'signature', document_id: documentId, page: 1, x: 380, y: 700 }],
    }),
  });

  const signerId = signer.id;
  const signatureLink = signer.signature_link;
  if (!signerId || !signatureLink) {
    throw new Error('Youtrust: réponse de création du signataire invalide (id ou lien de signature manquant).');
  }

  await youtrustFetch(`/signature_requests/${signatureRequestId}/activate`, { method: 'POST' });

  return { signatureRequestId, signerId, signatureLink };
}
