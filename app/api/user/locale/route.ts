// app/api/user/locale/route.ts
// PATCH -> persiste la langue choisie par le commercial (sélecteur de langue
// dans Shell, en haut de chaque page) sur users.locale, pour que le contenu
// dynamique généré par Aaron (conseils, emails, chat, devis) soit produit
// dans la bonne langue. Voir lib/locale-instruction.ts et
// migration_user_locale_2026-08-16.sql.
//
// Le sélecteur continue par ailleurs de mettre à jour l'interface
// immédiatement via localStorage (lib/i18n.js, useLocale) — cet appel est un
// simple "fire and forget" en plus, pour synchroniser côté serveur. Un échec
// ici ne doit jamais bloquer le changement de langue de l'UI.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAuthedUser, unauthorizedResponse } from '@/lib/auth-helpers';
import { LOCALE_NAMES } from '@/lib/locale-instruction';

export async function PATCH(request: NextRequest) {
  const authedUser = await getAuthedUser(request);
  if (!authedUser) return unauthorizedResponse();

  const body = await request.json();

  if (typeof body.locale !== 'string' || !LOCALE_NAMES[body.locale]) {
    return NextResponse.json({ error: 'Langue invalide' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ locale: body.locale })
    .eq('id', authedUser.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
