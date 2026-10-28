// lib/background.ts
// TRAVAIL EN ARRIÈRE-PLAN APRÈS LA RÉPONSE (28/10/2026, demande d'Alex :
// « que chaque fois que j'appuie sur n'importe quel bouton ça s'accepte
// vite, et qu'ensuite ça travaille en backend »).
//
// `after()` de Next 15 garde la fonction serverless en vie jusqu'à la fin du
// travail, APRÈS avoir renvoyé la réponse au navigateur. Le clic est donc
// confirmé tout de suite ; la note d'Aaron, l'email de remerciement, la
// synchro CRM… se font ensuite. Une erreur est journalisée, jamais remontée
// au navigateur (la réponse est déjà partie).
//
// À appeler PENDANT le traitement de la requête (avant le return), jamais
// depuis un cron ou un script hors requête.

import { after } from 'next/server';

export function runInBackground(label: string, work: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        await work();
      } catch (err: any) {
        console.error(`[arrière-plan] ${label} :`, err?.message || err);
      }
    });
  } catch (err: any) {
    // Hors contexte de requête (ne devrait pas arriver) : on exécute quand
    // même, sans bloquer l'appelant.
    console.error(`[arrière-plan] after() indisponible pour ${label} :`, err?.message || err);
    work().catch((e: any) => console.error(`[arrière-plan] ${label} :`, e?.message || e));
  }
}
