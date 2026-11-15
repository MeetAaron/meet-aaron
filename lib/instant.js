// lib/instant.js
//
// RUBRIQUES INSTANTANÉES (15/11/2026, Alex : « je veux une latence très
// courte quand je clique sur Agenda, Chat, Campagnes, Contacts »).
//
// Constat : changer de rubrique était déjà une navigation sans rechargement,
// mais la nouvelle page repartait de zéro — « Connexion… », puis
// « Chargement… », puis ses appels au serveur (0,6 à 0,8 s CHACUN depuis
// l'Australie, voir claude/statut-2026-10-28). Deux à trois secondes d'écran
// vide à chaque toucher, pour réafficher des données que l'app avait déjà
// reçues une minute plus tôt.
//
// Principe (« afficher ce qu'on sait, vérifier ensuite ») :
//   1. la dernière réponse de chaque liste est gardée EN MÉMOIRE VIVE ;
//   2. en revenant sur une rubrique, la page s'affiche tout de suite avec
//      cette dernière réponse (peekJson / initialJson) ;
//   3. elle redemande quand même la liste au serveur (freshJson) et se met
//      à jour sur place si quelque chose a changé ;
//   4. les rubriques pas encore visitées sont préparées en arrière-plan
//      (warmJson), pour que même le PREMIER toucher soit immédiat.
//
// Mémoire vive seulement — ni localStorage ni sessionStorage : aucune donnée
// de prospect n'est écrite dans le stockage du navigateur (inventaire CASA
// 6.6.1 de lib/supabase-browser.ts inchangé). Tout disparaît au rechargement
// de la page et à la déconnexion (qui recharge la page).

const mem = new Map(); // url -> { json, at }
const inflight = new Map(); // url -> Promise (préparations en cours)

// Identifiant d'utilisateur lisible DÈS LE PREMIER RENDU, mais seulement
// lors d'un changement de rubrique. Au tout premier chargement, le serveur
// a rendu « Connexion… » : rendre autre chose côté navigateur casserait la
// reprise du HTML (hydratation). window.__aaronHydrated est posé par
// components/AuthFetchInterceptor.jsx une fois cette reprise terminée.
// Pendant le rendu de la nouvelle rubrique, l'adresse est encore celle de
// la précédente : elle porte le même user_id (tous les liens de l'app
// l'ajoutent).
export function navUserId() {
  if (typeof window === 'undefined' || !window.__aaronHydrated) return null;
  try {
    return new URLSearchParams(window.location.search).get('user_id') || null;
  } catch {
    return null;
  }
}

export function peekJson(url) {
  const hit = mem.get(url);
  return hit ? hit.json : undefined;
}

export function rememberJson(url, json) {
  if (json && typeof json === 'object') mem.set(url, { json, at: Date.now() });
}

// Dernière réponse connue pour l'utilisateur courant, ou undefined.
// `build` reçoit l'identifiant et renvoie l'adresse de l'appel.
export function initialJson(build) {
  const id = navUserId();
  if (!id) return undefined;
  return peekJson(build(id));
}

// Remplace `fetch(url).then((r) => r.json())` : même résultat, et la réponse
// est mémorisée si le serveur a répondu correctement.
//
// Deux composants de la même page demandent souvent la même chose au même
// instant (la page et son habillage lisent tous deux /api/preferences) : un
// appel identique lancé depuis moins de 300 ms est partagé. Pas au-delà —
// après une action de l'utilisateur, il faut une réponse vraiment nouvelle.
const recent = new Map(); // url -> { at, promise }
export function freshJson(url) {
  const hit = recent.get(url);
  if (hit && Date.now() - hit.at < 300) return hit.promise;
  const promise = (async () => {
    const res = await fetch(url);
    const json = await res.json();
    if (res.ok) rememberJson(url, json);
    return json;
  })();
  recent.set(url, { at: Date.now(), promise });
  promise.catch(() => {}).finally(() => {
    const cur = recent.get(url);
    if (cur && cur.promise === promise) recent.delete(url);
  });
  return promise;
}

// « Afficher ce qu'on sait, vérifier ensuite » en un appel : `apply` reçoit
// tout de suite la dernière réponse connue (s'il y en a une), puis la
// réponse fraîche si elle diffère. À réserver aux `apply` qui ne font que
// poser des états (les appeler deux fois ne doit rien casser).
export function swrJson(url, apply) {
  const cached = peekJson(url);
  if (cached !== undefined) {
    try { apply(cached); } catch {}
  }
  return freshJson(url).then((fresh) => {
    let same = false;
    try { same = cached !== undefined && JSON.stringify(cached) === JSON.stringify(fresh); } catch {}
    if (!same) apply(fresh);
    return fresh;
  });
}

// Prépare en arrière-plan les réponses qui manquent ou qui ont plus de
// `maxAgeMs`. Silencieux : un échec ne change rien, la page fera son appel
// normalement.
export function warmJson(urls, maxAgeMs = 60000) {
  if (typeof window === 'undefined') return;
  urls.forEach((url) => {
    const hit = mem.get(url);
    if (hit && Date.now() - hit.at < maxAgeMs) return;
    if (inflight.has(url)) return;
    const p = freshJson(url)
      .catch(() => {})
      .finally(() => inflight.delete(url));
    inflight.set(url, p);
  });
}

// Les listes des quatre onglets du bas, pour un utilisateur donné. Mêmes
// adresses, au caractère près, que celles des pages (c'est la clé du cache).
export function tabDataUrls(userId) {
  return [
    `/api/preferences?user_id=${userId}`,
    `/api/users/${userId}`,
    `/api/campaigns?user_id=${userId}`,
    `/api/prospects?user_id=${userId}&scope=all`,
    `/api/appointments?user_id=${userId}`,
    `/api/availability?user_id=${userId}`,
    `/api/oauth-connections?user_id=${userId}`,
    `/api/chat-conversations?user_id=${userId}`,
    `/api/notifications?user_id=${userId}`,
  ];
}
