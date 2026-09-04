// app/api/prospects/[id]/vcard/route.ts
//
// « Enregistrer sur le téléphone » — version SERVEUR (04/09/2026).
//
// Retour d'Alex sur la version précédente : « ça me sort bien la fiche mais
// comme un fichier à enregistrer dans mes fichiers. Il faut qu'on puisse
// enregistrer dans les contacts de l'iPhone. » En cause : la Web Share API
// avec un fichier .vcf. iOS la traite comme un partage de FICHIER générique —
// la feuille propose « Enregistrer dans Fichiers », AirDrop, Mail… et
// l'application Contacts n'y apparaît pas toujours.
//
// Ce qui marche à coup sûr sur iPhone, depuis toujours : OUVRIR une URL dont
// la réponse est `text/vcard`. Safari reconnaît le type et affiche directement
// la fiche avec « Créer un nouveau contact » / « Ajouter à un contact
// existant ». Sur Android, Chrome télécharge le .vcf puis propose de l'ouvrir
// avec Contacts. Sur ordinateur, le fichier se télécharge (repli normal).
//
// Cette route sert donc la vCard telle quelle. L'authentification passe par
// `?token=` (comme /api/auth/google) : une navigation n'a pas d'en-tête
// Authorization, contrairement aux fetch() interceptés côté client.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUserFromToken } from '@/lib/auth-helpers';
import { buildVCard } from '@/lib/vcard';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const authedUser = token ? await getAuthedUserFromToken(token) : null;
  if (!authedUser) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('*, prospect_companies(name, address, website)')
    .eq('id', params.id)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: 'Prospect introuvable' }, { status: 404 });
  }
  if (authedUser.id !== prospect.assigned_user_id && authedUser.company_id !== prospect.company_id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  // Libellés traduits fournis par le client (la langue de l'interface n'est
  // pas connue côté serveur) — texte libre, échappé par buildVCard.
  const q = request.nextUrl.searchParams;
  const vcf = buildVCard(prospect, {
    personalityLabel: q.get('personality') || null,
    notesLabel: q.get('notes') || null,
    adviceLabel: q.get('advice') || null,
  });

  const filename = `${String(prospect.full_name || 'contact').replace(/[^\w\-]+/g, '_')}.vcf`;
  const ua = request.headers.get('user-agent') || '';
  // iPhone/iPad : `inline` pour que Safari affiche la fiche au lieu de la
  // télécharger. Partout ailleurs : `attachment`, sinon Chrome desktop
  // afficherait le texte brut de la vCard dans l'onglet.
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const disposition = `${isIOS ? 'inline' : 'attachment'}; filename="${filename}"`;

  return new NextResponse(vcf, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  });
}
