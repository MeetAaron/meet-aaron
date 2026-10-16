// lib/rate-limit.ts
// Limitation de débit pour les points d'accès NON AUTHENTIFIÉS.
//
// Pourquoi ce fichier existe (15/10/2026) : l'audit CASA a constaté qu'il
// n'y en avait AUCUNE, nulle part. Trois routes envoient un email sans
// qu'on sache qui appelle — vérification d'adresse, renvoi de vérification,
// demande de réinitialisation de mot de passe. N'importe qui pouvait les
// appeler en boucle. Le risque n'est pas seulement d'ennuyer quelqu'un :
// c'est NOTRE domaine qui envoie, donc c'est NOTRE réputation d'expéditeur
// qui s'effondre, et avec elle la délivrabilité de tous les emails de
// prospection de tous les clients.
//
// CE QUE CETTE IMPLÉMENTATION N'EST PAS, et il faut le savoir :
// le compteur vit en mémoire, dans l'instance serverless qui répond. Vercel
// en fait tourner plusieurs en parallèle et les recycle, donc un attaquant
// déterminé qui répartit ses appels passera à travers. C'est un garde-fou,
// pas une muraille.
//
// Pourquoi on s'en contente quand même, plutôt que d'ajouter Redis :
// Meet Aaron est édité par une personne, et chaque service en plus est un
// service de plus à payer, à surveiller et à réparer un dimanche. Le coût
// réel du tourniquet actuel — un service externe, une clé de plus dans les
// secrets — dépasse le bénéfice tant que le trafic reste ce qu'il est. Le
// jour où le volume le justifie, ce fichier est le SEUL endroit à changer :
// les routes appellent `checkRateLimit`, pas une implémentation.
//
// La protection RÉELLE contre le bourrage d'identifiants sur la connexion
// reste celle de Supabase Auth, côté plateforme : l'application ne voit
// jamais passer le mot de passe et ne peut donc pas compter les échecs.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Ménage opportuniste : on purge au passage plutôt qu'avec un minuteur, qui
// empêcherait une instance serverless de s'endormir.
function sweep(now: number) {
  if (buckets.size < 500) return;
  // forEach et non for...of : la cible TypeScript du projet est ES5, et
  // iterer une Map avec for...of y exige --downlevelIteration. C'est
  // exactement l'erreur qui a casse le build du 15/10 au 16/10.
  buckets.forEach((b, key) => {
    if (b.resetAt <= now) buckets.delete(key);
  });
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

/**
 * @param key     Ce qu'on compte : adresse IP, adresse email, ou les deux.
 * @param limit   Nombre d'appels autorisés dans la fenêtre.
 * @param windowMs Durée de la fenêtre, en millisecondes.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

// Identifiant d'appelant. x-forwarded-for est posé par Vercel et peut
// contenir une chaîne de mandataires : la PREMIÈRE adresse est celle du
// client. Elle reste falsifiable en théorie ; on l'accepte, parce que la
// limite par email ci-dessous ne l'est pas, elle.
export function callerKey(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'inconnu';
  return `${scope}:ip:${ip}`;
}

export function emailKey(scope: string, email: string): string {
  return `${scope}:email:${email.trim().toLowerCase()}`;
}

// Réponse normalisée. Le message reste volontairement vague et identique
// quel que soit le motif : dire « trop de tentatives pour CETTE adresse »
// apprendrait à un attaquant que l'adresse existe.
export function tooManyRequestsResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: 'Trop de demandes. Réessayez dans quelques minutes.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
      },
    }
  );
}
