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
import { createAaronVideoRoom, isAaronVideoAvailable } from './video-room';

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

// `startISO` : heure du rendez-vous, utilisée pour programmer l'expiration de
// la salle Aaron (voir lib/video-room.ts).
export async function resolveMeetingLink(
  userId: string,
  generatedLink?: string | null,
  startISO?: string | null
): Promise<string | null> {
  const permanent = await getPermanentMeetingLink(userId);
  if (permanent) return permanent;
  if (generatedLink) return generatedLink;
  // Ni salle permanente, ni agenda Google/Microsoft : Aaron fournit la salle
  // (10/09/2026, décision d'Alex : « je préfère une solution plutôt qu'un
  // frottement »).
  return createAaronVideoRoom(startISO);
}

// Le commercial aura-t-il un lien de visio, quelle que soit sa provenance ?
// Sert au prompt d'Aaron (commercial.peut_fournir_lien_visio) et à l'écran
// Connexions. Vrai dès qu'un agenda est connecté, qu'une salle permanente est
// saisie, ou que la salle Aaron est disponible.
export function aaronVideoConfigured(): boolean {
  return isAaronVideoAvailable();
}
