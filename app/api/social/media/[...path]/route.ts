// app/api/social/media/[...path]/route.ts
//
// AARON SOCIAL : sert une photo de post depuis meetaaron.app (21/11/2026).
// TikTok (Content Posting API, PULL_FROM_URL) ne tire une image que d'un
// domaine vérifié : le stockage reste privé, et c'est cette adresse qu'on
// lui donne. Le chemin (3 identifiants aléatoires) est contrôlé strictement.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { SOCIAL_MEDIA_BUCKET, SOCIAL_MEDIA_PATH } from '@/lib/social-media';

export const runtime = 'nodejs';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const path = (parts || []).join('/');
  if (!SOCIAL_MEDIA_PATH.test(path)) return new NextResponse('Not found', { status: 404 });

  const { data, error } = await supabaseAdmin.storage.from(SOCIAL_MEDIA_BUCKET).download(path);
  if (error || !data) return new NextResponse('Not found', { status: 404 });

  const ext = path.split('.').pop()!.toLowerCase();
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    status: 200,
    headers: {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
