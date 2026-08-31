// lib/contact-alerts.js
// Fusion pipeline (docx « mon avis » d'Alex, 31/08/2026) : « une alerte à
// côté du nom dans le tableau » — ce qui, sur une fiche contact, attend une
// action du commercial. Calculé côté client à partir des colonnes déjà
// renvoyées par GET /api/prospects?scope=all (aucun appel supplémentaire).
// Sert au badge « ! » du tableau, à la colonne « Prochaine étape » et à la
// fiche contact ; les notifications « stories » du tableau de bord
// (app/api/notifications) reprennent les mêmes règles côté serveur.
//
// Chaque alerte : { key, level: 'urgent' | 'todo', labelKey } — `urgent`
// s'affiche en rouge (« envoyer devis ! »), `todo` en ambre.

export function contactAlerts(p) {
  if (!p) return [];
  const alerts = [];
  const lost = p.is_lost === true || p.deal_stage === 'perdu' || p.status === 'rouge';
  const won = p.is_won === true || p.deal_stage === 'signe';
  const now = Date.now();

  if (!lost && !won && p.quote_requested_at && !p.devis_sent_at) {
    alerts.push({ key: 'quote_to_send', level: 'urgent', labelKey: 'alerts.quoteToSend' });
  }
  if (p.pending_first_email_subject) {
    alerts.push({ key: 'email_to_validate', level: 'todo', labelKey: 'alerts.emailToValidate' });
  }
  if (p.rescue_proposal_pending) {
    alerts.push({ key: 'rescue_to_validate', level: 'todo', labelKey: 'alerts.rescueToValidate' });
  }
  if (p.is_won && !p.first_order_confirmed_at && !lost) {
    alerts.push({ key: 'first_order_to_confirm', level: 'todo', labelKey: 'alerts.firstOrderToConfirm' });
  }
  const appt = p.latest_appointment;
  if (!lost && appt && !appt.outcome && appt.status === 'validé' && new Date(appt.proposed_at).getTime() < now) {
    alerts.push({ key: 'bilan_to_do', level: 'todo', labelKey: 'alerts.bilanToDo' });
  }
  return alerts;
}

export function hasUrgentAlert(p) {
  return contactAlerts(p).some((a) => a.level === 'urgent');
}
