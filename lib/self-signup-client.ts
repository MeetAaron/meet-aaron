// lib/self-signup-client.ts
//
// LE CLIENT QUI ARRIVE TOUT SEUL.
//
// Demande d'Alex (30/09/2026) : « certains, par le bouche a oreille,
// installeront directement l'appli eux-memes et paieront. Il faut que je les
// voie dans mes clients Meet Aaron. »
//
// lib/prospect-conversion.ts couvrait deja le cas du prospect DEMARCHE qui
// finit par payer. Celui qui n'a jamais ete demarche, lui, n'apparaissait
// nulle part : son compte se creait, son abonnement tournait, et le suivi
// commercial de Meet Aaron ne le connaissait pas.
//
// Ce fichier cree donc la fiche client manquante dans le compte Meet Aaron
// lui-meme — Meet Aaron se sert de Meet Aaron pour suivre ses propres
// clients. Le client est cree DEJA GAGNE : le paiement Stripe est la preuve,
// il n'y a ni rendez-vous ni devis a saisir.
//
// ── CE QUI DOIT ETRE CONFIGURE ────────────────────────────────────────────
//
//   MEETAARON_OWN_COMPANY_ID  companies.id du compte Meet Aaron
//   MEETAARON_OWN_USER_ID     users.id du commercial qui suivra ces clients
//
// Sans ces deux variables, la fonction ne fait RIEN et le dit une fois dans
// les logs. C'est volontaire : ecrire dans une societe devinee serait pire
// que de ne rien ecrire, et ce chemin s'execute juste apres un paiement
// encaisse — il ne doit jamais rien faire echouer.
//
// ── POURQUOI PAS DE DECLENCHEMENT D'ONBOARDING ────────────────────────────
//
// convertMatchingProspectsToClients appelle triggerAutomaticOnboarding :
// email de bienvenue, proposition de rendez-vous de lancement. Ici on ne le
// fait PAS. Quelqu'un qui vient de s'inscrire tout seul recoit deja les
// emails d'inscription de l'application ; lui envoyer en plus un « ravi de
// vous compter parmi nos clients, quand se voit-on ? » ecrit par Aaron au nom
// d'Alex, dans la minute qui suit son paiement, ferait exactement l'inverse
// de l'effet recherche. La fiche est creee, Alex decide ensuite.

import { supabaseAdmin } from './supabase-admin';

// Domaines grand public : on ne cree jamais de fiche societe rattachee a un
// domaine partage, sinon tous les clients en @gmail.com se retrouveraient
// dans la meme entreprise. Meme raisonnement que dans
// app/api/prospects/route.ts.
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com',
  'hotmail.fr', 'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr',
  'icloud.com', 'me.com', 'free.fr', 'orange.fr', 'wanadoo.fr', 'sfr.fr',
  'laposte.net', 'bbox.fr', 'proton.me', 'protonmail.com', 'gmx.com',
]);

let warnedMissingConfig = false;

export interface SelfSignupInput {
  email: string;
  fullName?: string | null;
  companyName?: string | null;
  country?: string | null;
  stripeCustomerId?: string | null;
}

export interface SelfSignupResult {
  created: boolean;
  prospectId?: string;
  reason?: 'not_configured' | 'no_email' | 'already_known' | 'error';
}

export async function ensureSelfSignupClient(input: SelfSignupInput): Promise<SelfSignupResult> {
  const ownCompanyId = (process.env.MEETAARON_OWN_COMPANY_ID || '').trim();
  const ownUserId = (process.env.MEETAARON_OWN_USER_ID || '').trim();
  const email = String(input.email || '').toLowerCase().trim();

  if (!email) return { created: false, reason: 'no_email' };

  if (!ownCompanyId || !ownUserId) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        '[Inscription directe] MEETAARON_OWN_COMPANY_ID et/ou MEETAARON_OWN_USER_ID absentes : ' +
        'les inscriptions spontanees ne seront pas ajoutees au suivi client de Meet Aaron. ' +
        'Ce message n\'apparait qu\'une fois par instance.'
      );
    }
    return { created: false, reason: 'not_configured' };
  }

  try {
    // Deja connu ? Deux cas, et aucun ne doit creer de doublon :
    //   - il avait ete demarche : convertMatchingProspectsToClients vient de
    //     le basculer en client, il n'y a rien a faire ici ;
    //   - Stripe rejoue son evenement (il le fait) : meme conclusion.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('prospects')
      .select('id, is_won')
      .eq('company_id', ownCompanyId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error('[Inscription directe] recherche du prospect impossible :', lookupError.message);
      return { created: false, reason: 'error' };
    }

    if (existing) {
      // Filet de securite : connu mais pas marque gagne (il avait ete saisi a
      // la main sans jamais etre converti). Le paiement tranche.
      if (!(existing as any).is_won) {
        const now = new Date().toISOString();
        await supabaseAdmin
          .from('prospects')
          .update({ is_won: true, won_at: now, is_lost: false, first_order_confirmed_at: now, status: 'vert' })
          .eq('id', (existing as any).id);
      }
      return { created: false, prospectId: (existing as any).id, reason: 'already_known' };
    }

    // ── Fiche societe ────────────────────────────────────────────────────
    const domain = email.split('@')[1] || '';
    const matchableDomain = domain && !CONSUMER_DOMAINS.has(domain) ? domain : null;
    const companyLabel =
      (input.companyName || '').trim() ||
      (matchableDomain ? matchableDomain : email.split('@')[0]);

    let prospectCompanyId: string | null = null;

    if (matchableDomain) {
      const { data: found } = await supabaseAdmin
        .from('prospect_companies')
        .select('id')
        .eq('company_id', ownCompanyId)
        .eq('domain', matchableDomain)
        .maybeSingle();
      if (found) prospectCompanyId = (found as any).id;
    }

    if (!prospectCompanyId) {
      const { data: newCompany, error: companyError } = await supabaseAdmin
        .from('prospect_companies')
        .insert({
          company_id: ownCompanyId,
          name: companyLabel,
          // null pour un domaine grand public : la contrainte d'unicite
          // (company_id, domain) accepte plusieurs null, jamais deux fois
          // 'gmail.com'.
          domain: matchableDomain,
          address: input.country || null,
          is_won_client: true,
        })
        .select('id')
        .single();

      if (companyError || !newCompany) {
        console.error('[Inscription directe] creation de la fiche societe impossible :', companyError?.message);
        return { created: false, reason: 'error' };
      }
      prospectCompanyId = (newCompany as any).id;
    }

    // ── Fiche client ─────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from('prospects')
      .insert({
        company_id: ownCompanyId,
        prospect_company_id: prospectCompanyId,
        assigned_user_id: ownUserId,
        full_name: (input.fullName || '').trim() || email,
        email,
        status: 'vert',
        status_updated_at: now,
        is_won: true,
        won_at: now,
        is_lost: false,
        // Le paiement EST la premiere commande — meme raisonnement que dans
        // lib/prospect-conversion.ts.
        first_order_confirmed_at: now,
        origin: 'inscription_directe',
      })
      .select('id')
      .single();

    if (prospectError || !prospect) {
      // Repli si migration_client_inscription_directe_2026-09-30.sql n'est
      // pas encore passee : la contrainte refuse 'inscription_directe'. On
      // reessaie avec la valeur historique plutot que de perdre le client —
      // mieux vaut une provenance imprecise qu'un client invisible.
      const isCheckViolation = (prospectError as any)?.code === '23514';
      if (isCheckViolation) {
        const { data: retry, error: retryError } = await supabaseAdmin
          .from('prospects')
          .insert({
            company_id: ownCompanyId,
            prospect_company_id: prospectCompanyId,
            assigned_user_id: ownUserId,
            full_name: (input.fullName || '').trim() || email,
            email,
            status: 'vert',
            status_updated_at: now,
            is_won: true,
            won_at: now,
            is_lost: false,
            first_order_confirmed_at: now,
            origin: 'amene_par_toi',
          })
          .select('id')
          .single();
        if (!retryError && retry) {
          console.warn(
            `[Inscription directe] ${email} enregistre avec origin='amene_par_toi' : ` +
            'migration_client_inscription_directe_2026-09-30.sql pas encore jouee.'
          );
          return { created: true, prospectId: (retry as any).id };
        }
        console.error('[Inscription directe] creation du client impossible (repli) :', retryError?.message);
        return { created: false, reason: 'error' };
      }
      console.error('[Inscription directe] creation du client impossible :', prospectError?.message);
      return { created: false, reason: 'error' };
    }

    console.log(
      `[Inscription directe] ${email} ajoute aux clients de Meet Aaron ` +
      `(prospect ${(prospect as any).id}, societe ${companyLabel}).`
    );
    return { created: true, prospectId: (prospect as any).id };
  } catch (err: any) {
    console.error('[Inscription directe] erreur inattendue :', err?.message);
    return { created: false, reason: 'error' };
  }
}
