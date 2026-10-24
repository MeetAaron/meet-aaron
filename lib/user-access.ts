// lib/user-access.ts
// LECTURE DES DONNÉES D'UN AUTRE MEMBRE DE L'ÉQUIPE (24/10/2026).
//
// Les listes « par commercial » (GET /api/prospects, /api/appointments,
// /api/campaigns ?user_id=…) n'acceptaient que user_id === l'utilisateur
// connecté. Or la page Mon équipe -> fiche d'un commercial
// (app/app/team/[id]/page.jsx) les appelle avec l'id du COMMERCIAL : le
// patron recevait 403 sur les trois et voyait « 0 prospect, 0 RDV,
// 0 campagne », sans message d'erreur.
//
// Règle : soi-même, ou le patron d'une même société (vérifiée en base, pas
// sur un paramètre envoyé par le navigateur). LECTURE SEULEMENT : toutes les
// actions (envoyer, modifier, supprimer) restent réservées au commercial
// lui-même.

import { supabaseAdmin } from '@/lib/supabase-admin';
import type { AuthedUser } from '@/lib/auth-helpers';

export async function canViewUserData(authedUser: AuthedUser, targetUserId: string | null | undefined): Promise<boolean> {
  if (!targetUserId) return false;
  if (authedUser.id === targetUserId) return true;
  if (authedUser.role !== 'patron' || !authedUser.company_id) return false;
  try {
    const { data } = await supabaseAdmin.from('users').select('company_id').eq('id', targetUserId).maybeSingle();
    return !!data && (data as any).company_id === authedUser.company_id;
  } catch {
    // Échec sûr : en cas d'erreur de lecture, refus.
    return false;
  }
}
