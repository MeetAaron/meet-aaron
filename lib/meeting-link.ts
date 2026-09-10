// lib/meeting-link.ts
//
// LIEN DE VISIO d'un rendez-vous (10/09/2026).
//
// Trois cas, un seul point d'entrée pour que les appelants n'aient rien à
// savoir du fournisseur :
//   - le commercial a renseigné une salle permanente dans Préférences
//     (users.meeting_link) → elle gagne TOUJOURS. Beaucoup préfèrent leur
//     propre Zoom/Whereby au lien généré, et c'est aussi plus pratique pour
//     le prospect : le même lien figure dans tous les emails du fil.
//   - sinon, le lien à usage unique créé par Google Meet ou Teams à la
//     création de l'événement (voir createGoogleCalendarEvent /
//     createOutlookCalendarEvent).
//   - sinon rien : boîte « Autre boîte mail » (IMAP) sans salle permanente.
//     Aucun service ne sait fabriquer un lien de visio sans compte Google ou
//     Microsoft — c'est pour ce cas précis que le champ Préférences existe.
//
// Best-effort : jamais bloquant, un souci de lecture renvoie le lien généré.

import { supabaseAdmin } from './supabase-admin';

export async function getPermanentMeetingLink(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.from('users').select('meeting_link').eq('id', userId).maybeSingle();
    if (error) return null; // colonne absente (migration pas encore passée)
    const link = String((data as any)?.meeting_link || '').trim();
    return link || null;
  } catch {
    return null;
  }
}

export async function resolveMeetingLink(userId: string, generatedLink?: string | null): Promise<string | null> {
  const permanent = await getPermanentMeetingLink(userId);
  return permanent || generatedLink || null;
}
