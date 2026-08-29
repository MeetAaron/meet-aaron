// lib/rtf-document.ts
// Génère un document .rtf (Rich Text Format) — l'export "Word" du profil
// d'entreprise (demande Alex, 27/08/2026 : "à tout moment l'utilisateur doit
// pouvoir télécharger soit en Word soit en pdf"). RTF plutôt qu'un vrai
// .docx (format OOXML) : générer un .docx correctement nécessiterait la
// librairie npm `docx`, or l'accès au registre npm est bloqué dans cet
// environnement (impossible d'installer une nouvelle dépendance ni de
// vérifier qu'elle s'installerait correctement sur Vercel) — voir aussi
// lib/document-extraction.ts et lib/docx-extraction.ts pour la même
// contrainte côté lecture. RTF est un format texte simple (aucune
// dépendance requise), ouvert nativement et sans avertissement par Word,
// LibreOffice Writer et Google Docs — un utilisateur qui clique "Télécharger
// en Word" obtient un fichier qui s'ouvre directement dans Word.
//
// Testé manuellement (génération -> conversion .docx -> réenregistrement
// .rtf via LibreOffice headless) pour confirmer un aller-retour propre,
// accents français compris (voir aussi lib/rtf-extraction.ts, qui relit ce
// même format quand l'utilisateur renvoie une version modifiée).

// Échappe le texte pour RTF : \, {, } doivent être échappés littéralement, et
// tout caractère non-ASCII (accents, guillemets français, tirets cadratins,
// emoji...) passe par l'échappement unicode \uNNNN? — le "?" est le
// caractère de repli pour les lecteurs RTF très anciens qui ne géreraient
// pas \u ; voir lib/rtf-extraction.ts qui sait sauter ce repli correctement.
function rtfEscape(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (ch === '\\') out += '\\\\';
    else if (ch === '{') out += '\\{';
    else if (ch === '}') out += '\\}';
    else if (code < 128) out += ch;
    else out += `\\u${code}?`;
  }
  return out;
}

import { classifyBusinessProfileParagraph, splitBusinessProfileParagraphs } from './business-profile-format';
import type { CompanyKeyStats } from './company-stats';

export interface BusinessProfileDocData {
  companyName: string;
  legalLines: string[];
  bodyText: string; // texte brut du profil (companies.business_summary), paragraphes séparés par des lignes vides
  generatedAtLabel: string;
  // Statistiques réelles calculées à l'export (lib/company-stats.ts) — null
  // quand la société n'a encore aucune activité enregistrée. Rendues en
  // liste texte ici (pas de graphique en RTF, voir lib/business-profile-pdf.ts
  // pour la version avec un vrai graphique en barres, réservée au PDF).
  stats?: CompanyKeyStats | null;
}

export function buildBusinessProfileRtf(data: BusinessProfileDocData): string {
  const parts: string[] = [];
  parts.push('{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1036');
  parts.push('{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}');
  // Palette reprise de lib/invoice-pdf.ts pour rester cohérent avec le reste
  // de l'app : 1 = texte foncé (#131629), 2 = accent violet (#4b39ef),
  // 3 = gris atténué (#8b90a8).
  parts.push('{\\colortbl;\\red19\\green22\\blue41;\\red75\\green57\\blue239;\\red139\\green144\\blue168;}');
  parts.push('\\margl1440\\margr1440\\margt1440\\margb1440');

  parts.push(`\\pard\\qc\\f1\\fs40\\b\\cf1 ${rtfEscape(data.companyName || 'Profil de l’entreprise')}\\b0\\par`);
  parts.push(`\\pard\\qc\\f1\\fs22\\cf2 ${rtfEscape('Profil de l’entreprise — généré par Meet Aaron')}\\cf1\\par`);
  if (data.legalLines.length) {
    parts.push(`\\pard\\qc\\f1\\fs16\\cf3 ${data.legalLines.map(rtfEscape).join('\\line ')}\\cf1\\par`);
  }
  parts.push('\\pard\\par');

  const paragraphs = splitBusinessProfileParagraphs(data.bodyText);
  if (paragraphs.length === 0) {
    parts.push(`\\pard\\f0\\fs24\\cf3\\i ${rtfEscape('Aucun profil renseigné pour le moment.')}\\i0\\cf1\\par`);
  }
  for (const para of paragraphs) {
    const classified = classifyBusinessProfileParagraph(para);
    if (classified.type === 'heading') {
      // Titre de section (profil enrichi, 29/08/2026) : plus grand, en gras,
      // couleur accent, avec un espacement avant/après généreux pour bien
      // séparer les sections dans le document Word.
      parts.push(`\\pard\\f1\\fs30\\sb400\\sa160\\cf2\\b ${rtfEscape(classified.text)}\\b0\\cf1\\par`);
    } else if (classified.type === 'marker') {
      parts.push(`\\pard\\f0\\fs24\\sa200\\cf2\\b ${rtfEscape(classified.label)}\\b0\\cf1 ${rtfEscape(classified.rest)}\\par`);
    } else {
      parts.push(`\\pard\\f0\\fs24\\sa200\\cf1 ${rtfEscape(classified.text)}\\par`);
    }
  }

  if (data.stats) {
    // Section "Statistiques clés" (demande Alex, 29/08/2026) — mêmes
    // chiffres que l'export PDF, sans le graphique en barres (RTF texte pur,
    // voir le commentaire d'en-tête de ce fichier sur ce choix de format).
    parts.push(`\\pard\\f1\\fs30\\sb400\\sa160\\cf2\\b ${rtfEscape('Statistiques clés')}\\b0\\cf1\\par`);
    const s = data.stats;
    const statLine = [
      `${s.prospectsDemarches} prospect${s.prospectsDemarches > 1 ? 's' : ''} démarché${s.prospectsDemarches > 1 ? 's' : ''}`,
      `${s.clientsConvertis} client${s.clientsConvertis > 1 ? 's' : ''} converti${s.clientsConvertis > 1 ? 's' : ''}`,
      `${s.tauxConversionRdv}% de taux de conversion en RDV`,
      s.campagnesMenees > 0
        ? `${s.campagnesMenees} campagne${s.campagnesMenees > 1 ? 's' : ''} de prospection menée${s.campagnesMenees > 1 ? 's' : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('   •   ');
    parts.push(`\\pard\\f0\\fs24\\sa160\\cf1 ${rtfEscape(statLine)}\\par`);
    if (s.pipelineParEtape.length > 0) {
      parts.push(`\\pard\\f0\\fs20\\sa80\\cf3\\i ${rtfEscape('Répartition du pipeline commercial :')}\\i0\\cf1\\par`);
      for (const stage of s.pipelineParEtape) {
        parts.push(`\\pard\\f0\\fs24\\sa60\\cf1 ${rtfEscape(`– ${stage.label} : ${stage.count}`)}\\par`);
      }
    }
  }

  parts.push('\\par\\pard\\qc\\f1\\fs16\\cf3 ' + rtfEscape(data.generatedAtLabel) + '\\par');
  parts.push('}');
  return parts.join('\n');
}
