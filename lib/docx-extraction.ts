// lib/docx-extraction.ts
// Extrait le texte brut d'un fichier .docx (Word, format OOXML) — utilisé
// quand l'utilisateur renvoie une version modifiée de son "Profil de
// l'entreprise" en .docx (demande Alex, 27/08/2026). Implémentation pure JS,
// sans dépendance (ex: `mammoth`) : l'accès au registre npm est bloqué dans
// cet environnement, impossible d'installer/vérifier une nouvelle dépendance
// avant de la pousser sur une app en production (voir aussi
// lib/rtf-document.ts pour la même contrainte côté écriture). Un .docx est
// un fichier zip contenant du XML (word/document.xml) — Node fournit déjà
// tout le nécessaire (zlib pour l'inflate DEFLATE) sans rien installer.
//
// Ne gère qu'une lecture minimale du format zip (assez pour retrouver
// l'entrée "word/document.xml", stockée ou compressée en deflate — les deux
// seules méthodes que Word/LibreOffice produisent) — pas un lecteur zip
// générique. Testé manuellement contre un vrai .docx généré par LibreOffice,
// accents français compris.

import zlib from 'zlib';

function readZipEntry(buffer: Buffer, targetName: string): Buffer | null {
  const EOCD_SIG = 0x06054b50;
  const maxBack = Math.min(buffer.length, 65557); // taille max d'un commentaire de zip (65535) + 22 octets d'EOCD
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= buffer.length - maxBack && i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Fin de répertoire central introuvable — fichier zip invalide ou corrompu');

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  let offset = centralDirOffset;
  const CENTRAL_SIG = 0x02014b50;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length) break;
    const sig = buffer.readUInt32LE(offset);
    if (sig !== CENTRAL_SIG) throw new Error('Entrée de répertoire central invalide');

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf-8', offset + 46, offset + 46 + fileNameLength);

    if (fileName === targetName) {
      const LOCAL_SIG = 0x04034b50;
      const localSig = buffer.readUInt32LE(localHeaderOffset);
      if (localSig !== LOCAL_SIG) throw new Error('En-tête local invalide');
      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) return Buffer.from(compressedData);
      if (compressionMethod === 8) return zlib.inflateRawSync(compressedData);
      throw new Error(`Méthode de compression zip non supportée : ${compressionMethod}`);
    }

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return null;
}

function xmlToText(xml: string): string {
  return xml
    // Chaque fin de paragraphe (</w:p>) devient un saut de ligne double, pour
    // préserver la structure en paragraphes du document original.
    .replace(/<\/w:p>/g, '\n\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    // Retire toutes les balises restantes (runs, propriétés de mise en
    // forme, sauts de section, etc.) — on ne veut que le texte visible.
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Renvoie null si le fichier n'est pas un .docx exploitable (zip invalide,
// pas de word/document.xml) — l'appelant doit traiter ça comme "extraction
// impossible", pas comme une erreur bloquante.
export function extractTextFromDocx(buffer: Buffer): string | null {
  try {
    const xmlBuffer = readZipEntry(buffer, 'word/document.xml');
    if (!xmlBuffer) return null;
    const text = xmlToText(xmlBuffer.toString('utf-8'));
    return text || null;
  } catch (err) {
    console.error('Erreur extraction texte .docx:', err);
    return null;
  }
}
