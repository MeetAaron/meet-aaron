// lib/appointment-access.ts
// QUI PEUT OUVRIR UN RENDEZ-VOUS (23/10/2026, bug remonté par Alex : « Faire
// le bilan » affichait « Accès refusé »).
//
// Avant, les routes /api/appointments/[id]/* ne regardaient que le PROSPECT
// lié (commercial assigné ou même société). Or un rendez-vous peut être pris
// avec un contact saisi à la main (appointments.contact_name, sans
// prospect_id) : pas de prospect, donc refus systématique, y compris pour le
// commercial à qui appartient le rendez-vous. La règle est désormais :
//   - le commercial du rendez-vous (appointments.user_id) ;
//   - OU le commercial assigné au prospect ;
//   - OU un membre de la même société que le prospect (company_id renseigné :
//     deux valeurs vides ne valent jamais « même société »).
export function canAccessAppointment(
  authedUser: { id: string; company_id: string | null },
  appointment: { user_id?: string | null; prospects?: { assigned_user_id?: string | null; company_id?: string | null } | null }
): boolean {
  if (appointment.user_id && appointment.user_id === authedUser.id) return true;
  const p = appointment.prospects || null;
  if (p?.assigned_user_id && p.assigned_user_id === authedUser.id) return true;
  if (p?.company_id && authedUser.company_id && p.company_id === authedUser.company_id) return true;
  return false;
}
