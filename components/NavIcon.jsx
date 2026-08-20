// components/NavIcon.jsx
// Icônes de la barre latérale (tâche #129, piste 1 : remplacer les emojis par de
// vraies icônes). Un seul point central pour la correspondance slug -> icône,
// même si le tableau NAV_ITEMS reste dupliqué par page (convention déjà en place
// dans ce projet) — ça évite de dupliquer aussi le choix de chaque icône.
//
// Le champ `icon` (emoji) laissé dans les tableaux NAV_ITEMS de chaque page n'est
// plus utilisé pour l'affichage (remplacé par ce composant), mais n'a pas été
// retiré : il sert de repère lisible dans le code, et le retirer aurait obligé à
// toucher une ligne par item de nav sur 15 pages pour un gain nul.

'use client';

import {
  BarChart3,
  Target,
  Handshake,
  Coins,
  Star,
  Rocket,
  Calendar,
  TrendingUp,
  Folder,
  MessageCircle,
  Link2,
  Settings,
  Users,
  Lightbulb,
  Lock,
} from 'lucide-react';

const NAV_ICON_BY_SLUG = {
  dashboard: BarChart3,
  prospects: Target,
  sales: Handshake,
  products: Coins,
  customer: Star,
  campaigns: Rocket,
  agenda: Calendar,
  resultats: TrendingUp,
  documents: Folder,
  chat: MessageCircle,
  connexions: Link2,
  preferences: Settings,
  team: Users,
  suggestions: Lightbulb,
};

// size en px (l'icône est centrée dans le conteneur .nav-icon existant, qui gère
// déjà la taille de la boîte 1.75em x 1.75em et son fond).
export function NavIcon({ slug, size = 16 }) {
  const Icon = NAV_ICON_BY_SLUG[slug];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

export function LockIcon({ size = 12 }) {
  return <Lock size={size} strokeWidth={2} aria-hidden="true" />;
}
