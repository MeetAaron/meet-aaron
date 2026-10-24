// lib/chunked-in.ts
// FILTRES .in() SUR DE LONGUES LISTES D'IDENTIFIANTS (24/10/2026).
//
// Supabase (PostgREST) passe les filtres dans l'URL : `.in('prospect_id', ids)`
// avec quelques centaines d'UUID (36 caractères chacun) dépasse la longueur
// d'URL acceptée par la passerelle et la requête échoue (« URI too long »),
// souvent en silence parce que l'erreur n'est pas lue. Typiquement après un
// import CSV de plusieurs centaines de contacts : liste de prospects sans
// ses RDV, boîte support vide, suppression de compte incomplète.
//
// On découpe donc en paquets de IN_CHUNK identifiants, on fusionne, et on
// retrie si l'appelant dépendait d'un ORDER BY (chaque paquet est trié, pas
// l'ensemble).

export const IN_CHUNK = 150;

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Res = { data: any[] | null; error: any };

// SELECT découpé. `run(part)` construit la requête pour un paquet.
// `sortBy` : colonne à retrier après fusion (ISO date ou nombre).
export async function selectInChunks<T = any>(
  ids: string[],
  run: (part: string[]) => PromiseLike<Res>,
  opts: { sortBy?: string; ascending?: boolean; limit?: number } = {}
): Promise<{ data: T[]; error: any }> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return { data: [], error: null };
  const results = await Promise.all(chunk(unique).map((part) => run(part)));
  const error = results.find((r) => r.error)?.error || null;
  let data: any[] = results.flatMap((r) => r.data || []);
  if (opts.sortBy) {
    const key = opts.sortBy;
    const dir = opts.ascending ? 1 : -1;
    data.sort((a, b) => {
      const x = a?.[key], y = b?.[key];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * dir;
    });
  }
  if (opts.limit !== undefined) data = data.slice(0, opts.limit);
  return { data: data as T[], error };
}

// DELETE/UPDATE découpé, paquet par paquet (séquentiel : on ne veut pas
// noyer la base pendant une suppression de compte).
export async function forEachChunk(ids: string[], run: (part: string[]) => PromiseLike<{ error: any }>): Promise<any> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  let firstError: any = null;
  for (const part of chunk(unique)) {
    const { error } = await run(part);
    if (error && !firstError) firstError = error;
  }
  return firstError;
}
