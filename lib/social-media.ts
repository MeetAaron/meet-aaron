// lib/social-media.ts
//
// AARON SOCIAL : photos fournies par le client pour ses posts (21/11/2026).
//
// Les fichiers vivent dans le stockage Supabase « social-media » (privé) et
// sont servis par meetaaron.app (/api/social/media/<chemin>) : TikTok ne tire
// une photo que d'un domaine vérifié, et meetaaron.app l'est. Le chemin est
// fait de trois identifiants aléatoires (société / post / fichier) : il ne se
// devine pas, et ces photos sont de toute façon faites pour être publiées.

export const SOCIAL_MEDIA_BUCKET = 'social-media';
export const SOCIAL_MEDIA_MAX_BYTES = 4 * 1024 * 1024; // sous la limite de 4,5 Mo des fonctions Vercel
export const SOCIAL_MEDIA_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const SOCIAL_MEDIA_MAX_PER_POST = 10;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const SOCIAL_MEDIA_PATH = new RegExp(`^${UUID}/${UUID}/${UUID}\\.(jpg|png|webp)$`, 'i');

export interface SocialMediaItem {
  path: string;
  added_at: string;
}

export function socialMediaUrl(path: string): string {
  const base = (process.env.APP_URL || 'https://meetaaron.app').replace(/\/+$/, '');
  return `${base}/api/social/media/${path}`;
}

export function cleanMediaList(value: any): SocialMediaItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m) => m && typeof m.path === 'string' && SOCIAL_MEDIA_PATH.test(m.path))
    .map((m) => ({ path: m.path, added_at: typeof m.added_at === 'string' ? m.added_at : new Date().toISOString() }));
}

// Un post est prêt quand ce qu'il demandait est là.
export function postIsReady(post: { material_needed?: string | null; media?: any; review_text?: string | null }): boolean {
  if (post.material_needed === 'photo') return cleanMediaList(post.media).length > 0;
  if (post.material_needed === 'avis') return !!(post.review_text && post.review_text.trim());
  return true;
}
