// lib/xlsx-io.js
//
// Lecture et écriture de fichiers Excel (.xlsx) côté navigateur, via SheetJS
// (paquet npm "xlsx") — pour permettre, en plus du CSV existant, le choix
// CSV/Excel dans Prospects/Opportunités/Clients (demande Alex, 2026-08-25) :
// "aaron demande si il s'agit d'un csv (recommandé) ou xls (excel). si c'est
// xls alors aaron analysera par lui même et convertira dans le fichier qui
// lui va (csv par exemple)" — pour l'import, le téléchargement d'un fichier
// vierge, et le téléchargement de la base de données gérée par Aaron.
//
// Tout se passe dans le navigateur — aucune nouvelle route API, aucun accès
// direct à la base : mêmes principes de sécurité que le CSV existant (voir
// lib/csv-import.ts). L'import "xlsx" est fait en dynamique (import() au
// lieu d'un import statique) pour ne pas alourdir le bundle JS de chaque
// page Prospects/Opportunités/Clients avec cette librairie tant qu'elle
// n'est pas réellement utilisée (fichier Excel choisi, ou format Excel
// demandé pour un export/modèle).

// Lit un classeur Excel (ArrayBuffer) et renvoie un tableau de tableaux de
// cellules — EXACTEMENT la même forme que parseCsv() dans lib/csv-import.ts
// (une ligne = un tableau de chaînes). C'est cette forme commune qui permet
// au reste du pipeline d'import (autoMapColumns, buildMappedRows, relecture,
// assistance IA...) de fonctionner sans AUCUN changement, que le fichier
// déposé soit un CSV ou un Excel : la "conversion par Aaron" évoquée par
// Alex est exactement ça — transparente pour le composant d'import.
export async function parseXlsxArrayBuffer(buffer) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  // raw:false -> valeurs déjà formatées en texte (dates, nombres...) plutôt
  // que les types internes Excel, pour rester cohérent avec un import CSV où
  // tout est une chaîne. defval:'' -> les cellules vides deviennent '' au
  // lieu d'être omises (sinon des lignes de longueur inégale décalent le
  // mapping par index de colonne).
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows
    .map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))
    .filter((row) => row.some((cell) => cell.trim() !== ''));
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Génère et télécharge un fichier CSV ou Excel à partir d'en-têtes + lignes
// déjà traduites — utilisé pour l'export de la base de données gérée par
// Aaron ET pour le modèle vierge à remplir, dans Prospects/Opportunités/
// Clients (voir components/ExportFormatMenu.jsx, qui propose le choix
// CSV (recommandé) / Excel demandé par Alex pour ces deux usages).
export async function downloadSpreadsheet(headers, rows, filenameBase, format) {
  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Feuille 1');
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    triggerBlobDownload(
      new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${filenameBase}.xlsx`
    );
    return;
  }
  // Chemin CSV inchangé par rapport à l'ancien downloadCsvFile() dupliqué
  // dans chaque page (Prospects/Opportunités/Clients) — BOM UTF-8 pour un
  // affichage correct des accents dans Excel FR.
  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  triggerBlobDownload(new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' }), `${filenameBase}.csv`);
}
