// lib/calendar-sync.ts
// Synchro bidirectionnelle agenda Aaron <-> calendrier Google/Outlook du
// commercial (celui ajouté sur son iPhone dans Réglages > Calendrier).
//
// Demande Alex (28/08/2026, verbatim) : "tu me confirmes que les rdvs vont se
// mettre dans l'agenda du commercial c'est ca ? L'agenda sur son iphone ? Et
// si il a un rdv on est d'accord qu'aaron mettras dans son propre agenda du
// genre 'rdv géré par Ludovic (si le commercial s'appelle Ludovic)'. et si le
// commercial a un rdv medical par exemple dans son agenda iphone alors pareil
// aaron en rend note et le mets dans son propre agenda 'rdv medical'. [...]
// Et pareil, quand le commercial mets une indisponibilité ou un rdv
// manuellement dans l'agenda aaron, ca se met dans l'agenda de l'iphone du
// commercial. La seule exception est : les crenaux récurrents [...]"
//
// Ce fichier ne gère QUE le sens Google/Outlook -> Aaron (voir
// syncExternalCalendarForUser, appelée par le cron sync-external-calendar).
// Le sens Aaron -> Google/Outlook (RDV/indispo créés manuellement dans
// l'agenda) est géré directement dans les routes POST concernées
// (app/api/appointments/route.ts, app/api/availability/blocks/route.ts) —
// pas ici — car il n'a besoin d'aucune logique de réconciliation.

import { supabaseAdmin } from './supabase-admin';
import {
  listGoogleCalendarEvents,
  deleteGoogleCalendarEvent as _deleteGoogleCalendarEvent,
} from './google';
import {
  listOutlookCalendarEvents,
  deleteOutlookCalendarEvent as _deleteOutlookCalendarEvent,
} from './microsoft';
import { getConnectedProviders } from './messaging';

// Fenêtre de synchro : du moment présent à 60 jours devant soi. Au-delà, ça
// n'a pas d'utilité pratique (l'agenda Aaron ne sert pas à planifier à plus
// de 2 mois) et ça limite le volume d'appels API à chaque passage du cron.
// On ne remonte jamais le passé : une indisponibilité passée ne sert à rien
// dans l'agenda Aaron.
const SYNC_WINDOW_DAYS = 60;

// Mots-clés (best-effort, FR + EN — un commercial peut avoir son calendrier
// perso dans l'une ou l'autre langue) déclenchant le libellé "rdv médical"
// plutôt que le libellé générique. Heuristique simple sur le titre de
// l'événement externe — pas de garantie de detection à 100%, documenté comme
// tel : un rdv médical titré différemment (ex. juste un nom de praticien)
// tombera dans le libellé générique, ce qui reste correct (juste moins précis).
const MEDICAL_KEYWORDS = [
  'médecin', 'medecin', 'docteur', 'dr ', 'dr.', 'dentiste', 'médical', 'medical',
  'kiné', 'kine', 'kinésithérapeute', 'ostéopathe', 'osteopathe', 'ophtalmo',
  'dermato', 'cardiologue', 'gynéco', 'gyneco', 'clinique', 'hôpital', 'hopital',
  'pharmacie', 'radiologie', 'analyses', 'doctor', 'dentist', 'physician',
  'clinic', 'hospital', 'physio', 'therapy', 'checkup', 'health',
];

function isLikelyMedical(title: string): boolean {
  const lower = title.toLowerCase();
  return MEDICAL_KEYWORDS.some((kw) => lower.includes(kw));
}

// Libellés dans les 7 langues du site (voir lib/locale-instruction.ts pour le
// même choix de séparation : pas d'import de lib/i18n.js côté serveur).
// {name} est remplacé par le prénom du commercial (ou son nom complet /
// "le commercial" si l'un et l'autre manquent).
const GENERIC_LABEL: Record<string, string> = {
  fr: 'Rdv géré par {name}',
  en: 'Appointment handled by {name}',
  de: 'Termin von {name}',
  it: 'Appuntamento gestito da {name}',
  es: 'Cita gestionada por {name}',
  pt: 'Compromisso gerido por {name}',
  nl: 'Afspraak van {name}',
};

const MEDICAL_LABEL: Record<string, string> = {
  fr: 'Rdv médical',
  en: 'Medical appointment',
  de: 'Arzttermin',
  it: 'Appuntamento medico',
  es: 'Cita médica',
  pt: 'Consulta médica',
  nl: 'Medische afspraak',
};

function computeSyncLabel(title: string, locale: string, commercialName: string): string {
  const loc = GENERIC_LABEL[locale] ? locale : 'fr';
  if (isLikelyMedical(title)) {
    return MEDICAL_LABEL[loc];
  }
  return GENERIC_LABEL[loc].replace('{name}', commercialName);
}

type ExternalEvent = { id: string; title: string; start: string; end: string };

// Synchronise le calendrier Google et/ou Outlook d'UN commercial vers son
// agenda Aaron (availability_blocks, source='sync'). Best-effort par
// provider : un souci sur l'un (token expiré, API en erreur...) n'empêche pas
// l'autre de se synchroniser, ni le reste du cron de continuer pour les
// autres commerciaux. Retourne un petit résumé (utile pour les logs du cron).
export async function syncExternalCalendarForUser(userId: string): Promise<{
  userId: string;
  synced: number;
  removed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;
  let removed = 0;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('first_name, full_name, locale')
    .eq('id', userId)
    .maybeSingle();

  const commercialName = user?.first_name || user?.full_name || 'ton commercial';
  const locale = user?.locale || 'fr';

  const providers = await getConnectedProviders(userId);
  if (!providers.has('google') && !providers.has('microsoft')) {
    return { userId, synced: 0, removed: 0, errors: [] };
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const nowISO = now.toISOString();
  const windowEndISO = windowEnd.toISOString();

  // Événements déjà créés PAR Aaron (RDV validés, RDV/indispos manuels
  // poussés) — on ne les remonte jamais comme indisponibilité générique, ils
  // sont déjà représentés nativement dans l'agenda Aaron (ce serait un doublon).
  const [{ data: aaronAppointments }, { data: aaronBlocks }] = await Promise.all([
    supabaseAdmin.from('appointments').select('calendar_event_id').eq('user_id', userId).not('calendar_event_id', 'is', null),
    supabaseAdmin.from('availability_blocks').select('calendar_event_id').eq('user_id', userId).not('calendar_event_id', 'is', null),
  ]);
  const aaronOwnedEventIds = new Set<string>([
    ...((aaronAppointments || []).map((a: any) => a.calendar_event_id)),
    ...((aaronBlocks || []).map((b: any) => b.calendar_event_id)),
  ]);

  for (const provider of ['google', 'microsoft'] as const) {
    if (!providers.has(provider)) continue;

    try {
      const events: ExternalEvent[] =
        provider === 'google'
          ? await listGoogleCalendarEvents(userId, nowISO, windowEndISO)
          : await listOutlookCalendarEvents(userId, nowISO, windowEndISO);

      const externalEvents = events.filter((e) => !aaronOwnedEventIds.has(e.id));
      const seenExternalIds = externalEvents.map((e) => e.id);

      for (const event of externalEvents) {
        const reason = computeSyncLabel(event.title, locale, commercialName);
        const { error: upsertError } = await supabaseAdmin
          .from('availability_blocks')
          .upsert(
            {
              user_id: userId,
              start_at: event.start,
              end_at: event.end,
              reason,
              source: 'sync',
              calendar_provider: provider,
              external_event_id: event.id,
            },
            { onConflict: 'user_id,external_event_id' }
          );
        if (upsertError) {
          errors.push(`upsert ${provider} ${event.id}: ${upsertError.message}`);
        } else {
          synced++;
        }
      }

      // Réconciliation : supprime les blocs "sync" de ce provider dont
      // l'événement source n'existe plus côté Google/Outlook (annulé,
      // supprimé, déplacé hors fenêtre...).
      let staleQuery = supabaseAdmin
        .from('availability_blocks')
        .delete()
        .eq('user_id', userId)
        .eq('source', 'sync')
        .eq('calendar_provider', provider);

      // .not('col', 'in', array) : le client supabase-js formate lui-même la
      // liste pour PostgREST — jamais construire la chaîne "(a,b,c)" à la main
      // (risque d'échapper mal des ids contenant une virgule/parenthèse, ex.
      // certains ids Outlook encodés en base64url peuvent contenir des
      // caractères qui casseraient un filtre construit manuellement).
      staleQuery = seenExternalIds.length > 0
        ? staleQuery.not('external_event_id', 'in', seenExternalIds)
        : staleQuery;

      const { data: deleted, error: deleteError } = await staleQuery.select('id');
      if (deleteError) {
        errors.push(`reconciliation ${provider}: ${deleteError.message}`);
      } else {
        removed += deleted?.length || 0;
      }
    } catch (err: any) {
      errors.push(`${provider}: ${err.message}`);
    }
  }

  return { userId, synced, removed, errors };
}

// Ré-exports pratiques (le cron/les routes n'ont besoin d'importer que ce
// fichier pour la partie "suppression d'un événement poussé par Aaron").
export const deleteGoogleCalendarEvent = _deleteGoogleCalendarEvent;
export const deleteOutlookCalendarEvent = _deleteOutlookCalendarEvent;
