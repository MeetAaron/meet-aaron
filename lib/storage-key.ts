// lib/storage-key.ts
// Sanitise un nom de fichier pour l'utiliser dans une clé Supabase Storage.
//
// Bug corrigé le 25/08/2026 : un nom de fichier contenant des accents et/ou
// espaces (ex: "Vue éclatée porte basulante PRESTIGE II v3.pdf") provoquait
// une erreur "Invalid key" côté Supabase Storage — les clés Storage doivent
// être composées uniquement de caractères ASCII "sûrs". Le nom d'origine
// (avec accents) reste conservé tel quel dans file_name (DB, affichage,
// téléchargement) — seule la clé Storage (storage_path) est assainie.

export function sanitizeFilenameForStorageKey(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.slice(lastDot) : '';

  const sanitizedBase = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents (é -> e, à -> a, ...)
    .replace(/[^a-zA-Z0-9._-]+/g, '-') // espaces et autres caractères non-ASCII -> "-"
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150); // évite une clé démesurément longue

  const sanitizedExt = ext
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.]+/g, '');

  return (sanitizedBase || 'fichier') + sanitizedExt;
}
