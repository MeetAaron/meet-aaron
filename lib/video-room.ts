// lib/video-room.ts
//
// SALLE DE VISIO FOURNIE PAR AARON (10/09/2026).
//
// Contexte : Google Meet exige un compte Google, Teams un compte Microsoft.
// Un commercial dont la messagerie est ailleurs (OVH, Gandi, Ionos…) ne
// pouvait donc recevoir AUCUN lien de visio — et Jitsi, qui permettait
// historiquement de fabriquer un lien sans compte, impose désormais une
// authentification du créateur (août 2023). Décision d'Alex (10/09/2026) :
// « je préfère une solution plutôt qu'un frottement » — Aaron fournit donc
// lui-même la salle, gratuitement pour le commercial.
//
// Fournisseur : Daily.co (API REST, une salle par rendez-vous, le prospect
// rejoint depuis son navigateur sans compte ni installation). Palier gratuit
// de 10 000 minutes-participant par mois, soit ~165 rendez-vous de 30 min à
// deux ; au-delà ~0,24 $ le rendez-vous.
//
// Priorité des liens (voir lib/meeting-link.ts) :
//   1. salle permanente saisie par le commercial (Connexions) — son choix prime ;
//   2. lien Meet/Teams créé par son agenda quand il en a un ;
//   3. salle Aaron (ce fichier) pour tous les autres.
//
// Dégradation propre : sans DAILY_API_KEY, ou si l'API répond une erreur, on
// renvoie null et le rendez-vous se poursuit sans lien (Aaron oriente alors
// vers le téléphone ou le présentiel, voir le prompt système). Jamais
// bloquant : un souci de visio ne doit pas empêcher de poser un rendez-vous.

const DAILY_API = 'https://api.daily.co/v1/rooms';

// Une salle par rendez-vous, nom non devinable (les salles Daily sont
// accessibles par leur URL : un nom court ou prévisible serait une porte
// ouverte). 32 caractères aléatoires.
function randomRoomName(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'aaron-';
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function isAaronVideoAvailable(): boolean {
  return Boolean(process.env.DAILY_API_KEY);
}

// Crée la salle du rendez-vous. `startISO` sert à programmer l'expiration :
// la salle vit jusqu'à 3 h après l'heure prévue, ce qui couvre un rendez-vous
// qui déborde tout en évitant d'accumuler des salles ouvertes indéfiniment.
export async function createAaronVideoRoom(startISO?: string | null): Promise<string | null> {
  const key = process.env.DAILY_API_KEY;
  if (!key) return null;

  const startMs = startISO ? new Date(startISO).getTime() : Date.now();
  const base = Number.isFinite(startMs) ? startMs : Date.now();
  const exp = Math.floor(base / 1000) + 3 * 60 * 60;

  try {
    const response = await fetch(DAILY_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: randomRoomName(),
        privacy: 'public', // rejoignable par le lien seul : le prospect n'a ni compte ni jeton
        properties: {
          exp,
          max_participants: 6,
          // Écran d'accueil avant d'entrer (choix micro/caméra) : évite
          // d'arriver micro ouvert dans un rendez-vous commercial.
          enable_prejoin_ui: true,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Visio Aaron] création de salle refusée:', response.status, err.slice(0, 300));
      return null;
    }

    const room = await response.json();
    return room?.url || null;
  } catch (err: any) {
    console.error('[Visio Aaron] création de salle impossible:', err?.message || err);
    return null;
  }
}
