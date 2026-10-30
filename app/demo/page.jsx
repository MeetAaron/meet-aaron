// app/demo/page.jsx
// /demo -> page de démonstration statique (public/demo.html).
//
// Même mécanique que app/page.jsx, qui redirige vers /landing.html : la page
// est servie en statique depuis public/, hors du bundle Next, donc rien à
// charger côté client et aucune dépendance au reste de l'app. C'est la page
// que pointent les signatures des boîtes de prospection et le champ
// « Lien public à mentionner » d'Aaron — elle doit être la plus rapide et la
// plus sobre du site.
import { redirect } from 'next/navigation';

export default function DemoPage() {
  redirect('/demo.html');
}
