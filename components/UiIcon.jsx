'use client';

// components/UiIcon.jsx
//
// Icônes d'interface en traits (lucide), par NOM, pour remplacer les emojis
// qui servaient de symboles dans les boutons, puces et badges (docx
// « derniers ajouts », 05/09/2026 : « tous les symboles de l'appli doivent
// être modernes. TOUS. […] leur style fait années 2010 »).
//
// Pourquoi un composant par nom plutôt qu'un import lucide par page : un
// emoji porte ses propres couleurs et sa propre police (différentes sur
// Windows, iPhone, Android), un tracé hérite de la couleur du texte et de la
// taille du contexte — c'est ce qui rend l'ensemble cohérent. Passer par un
// nom garde aussi le code des pages lisible (`<Ic name="bot" />`) et permet
// de changer un tracé partout d'un seul coup.
//
// Usage : <Ic name="bot" />  (inline, aligné sur le texte)
//         <Ic name="check" size={16} strokeWidth={2.4} />

import {
  Bot,
  Paperclip,
  Ban,
  Download,
  Check,
  X,
  PartyPopper,
  Lock,
  AlertTriangle,
  Lightbulb,
  Smartphone,
  Monitor,
  Star,
  Calendar,
  Phone,
  Handshake,
  Video,
  Rocket,
  FileText,
  LifeBuoy,
  Mail,
  ClipboardList,
  Trophy,
  Flame,
  MessageCircle,
  Building2,
  Map,
  Globe,
  Hammer,
  Building,
  Factory,
  Landmark,
  Target,
  Megaphone,
  RefreshCw,
  BarChart3,
  MousePointerClick,
  Sparkles,
  Medal,
  Info,
  CheckCircle2,
  Smile,
  Meh,
  Frown,
  User,
  UserCheck,
  ArrowRight,
  Undo2,
  Pencil,
  Trash2,
  Plus,
  Upload,
  Play,
  Pause,
  Square,
  ChevronDown,
  ChevronUp,
  Clock,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

const ICONS = {
  bot: Bot,
  paperclip: Paperclip,
  ban: Ban,
  download: Download,
  check: Check,
  x: X,
  party: PartyPopper,
  lock: Lock,
  alert: AlertTriangle,
  bulb: Lightbulb,
  smartphone: Smartphone,
  monitor: Monitor,
  star: Star,
  calendar: Calendar,
  phone: Phone,
  handshake: Handshake,
  video: Video,
  rocket: Rocket,
  file: FileText,
  lifebuoy: LifeBuoy,
  mail: Mail,
  notes: ClipboardList,
  trophy: Trophy,
  flame: Flame,
  message: MessageCircle,
  city: Building2,
  map: Map,
  globe: Globe,
  hammer: Hammer,
  building: Building,
  factory: Factory,
  landmark: Landmark,
  target: Target,
  megaphone: Megaphone,
  refresh: RefreshCw,
  chart: BarChart3,
  click: MousePointerClick,
  sparkles: Sparkles,
  medal: Medal,
  info: Info,
  checkCircle: CheckCircle2,
  smile: Smile,
  meh: Meh,
  frown: Frown,
  user: User,
  userCheck: UserCheck,
  arrowRight: ArrowRight,
  undo: Undo2,
  pencil: Pencil,
  trash: Trash2,
  plus: Plus,
  upload: Upload,
  play: Play,
  pause: Pause,
  stop: Square,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  clock: Clock,
  trendUp: TrendingUp,
  trendDown: TrendingDown,
};

export default function Ic({ name, size = 14, strokeWidth = 2.2, fill, className, style }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      fill={fill}
      className={className}
      aria-hidden="true"
      style={{ verticalAlign: '-0.15em', flexShrink: 0, ...style }}
    />
  );
}
