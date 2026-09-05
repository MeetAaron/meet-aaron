// components/CsvImportModal.jsx
//
// Import CSV "intelligent" — partagé par Prospects / Opportunités / Clients
// (app/app/prospects/page.jsx, app/app/sales/page.jsx, app/app/customer/page.jsx).
// Contrairement à la convention du projet (chaque page duplique son propre
// Shell/modales), ce composant est mis en commun ici comme NavIcon ou
// AuthFetchInterceptor : la logique (parsing, mapping, appel IA borné,
// création en boucle) est identique dans les 3 contextes, seul le
// comportement après création change (voir la prop `context`) — la dupliquer
// 3 fois aurait surtout multiplié le risque de divergence sur la partie
// sensible (validation, création réseau).
//
// Étapes : upload -> mapping des colonnes -> relecture (avec assistance IA
// optionnelle et étroitement bornée, voir app/api/csv-import/analyze/route.ts)
// -> import (boucle d'appels aux endpoints /api/prospects déjà existants et
// déjà testés, PAS de nouvelle route de création en masse) -> résumé.
//
// Principe de sécurité repris du module Marketing : aucune donnée de contact
// (téléphone, poste, email, LinkedIn) n'est jamais inventée automatiquement.
// La seule aide IA (nom d'entreprise déduit du domaine email, détection de
// lignes de test, correction de casse) reste visible dans des champs
// éditables et n'est jamais appliquée sans relecture humaine avant le clic
// "Importer".

'use client';

import { useState } from 'react';
import { t, useLocale } from '@/lib/i18n';
import Ic from '@/components/UiIcon';
import { parseCsv, autoMapColumns, buildMappedRows, IMPORT_FIELDS, isGenericEmailDomain } from '@/lib/csv-import';
import { PIPELINE_STAGES, CATEGORY_ICONS } from '@/lib/pipeline';
import { parseXlsxArrayBuffer } from '@/lib/xlsx-io';

const MAX_ROWS = 500;
const AI_BATCH_SIZE = 40;

const FIELD_LABEL_KEYS = {
  full_name: 'csvImport.mapFieldFullName',
  first_name: 'csvImport.mapFieldFirstName',
  last_name: 'csvImport.mapFieldLastName',
  email: 'csvImport.mapFieldEmail',
  phone: 'csvImport.mapFieldPhone',
  company_name: 'csvImport.mapFieldCompany',
  job_title: 'csvImport.mapFieldJobTitle',
  // Corrigé le 03/09/2026 : 'pipeline_stage' avait été ajouté à IMPORT_FIELDS
  // (colonne « Progression » du modèle Excel, demande Alex du 01/09) sans
  // libellé ici — la ligne correspondante de l'écran de correspondance des
  // colonnes s'affichait donc sans titre, et l'utilisateur ne pouvait pas
  // deviner quelle colonne de son fichier y associer.
  pipeline_stage: 'csvImport.stageColumn',
};

export default function CsvImportModal({ userId, companyId, context, module, stageOrder, stageMeta, onClose, onImported }) {
  const [locale] = useLocale();
  const [step, setStep] = useState('upload');
  const [error, setError] = useState(null);
  const [truncatedWarning, setTruncatedWarning] = useState(null);

  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  // Docx pipeline "Réactivation" (Alex, 2026-08-23) : nom du fichier déposé,
  // pour tracer le lot de réactivation (voir app/api/reactivation/batches) —
  // utilisé uniquement quand context === 'reactivation'.
  const [fileName, setFileName] = useState('');
  const [reactivationConfirmed, setReactivationConfirmed] = useState(false);

  // Écran de validation du classement (demande Alex, 01/09/2026 — « option A+C » :
  // A = la colonne « Progression » est lue dans le fichier ; C = Aaron propose un
  // classement pour les lignes que le fichier ne renseigne pas, et le commercial
  // le valide AVANT que quoi que ce soit ne parte).
  //
  // Pourquoi c'est important : c'est ici que se joue l'accident que le commercial
  // redoute le plus en déposant sa base — qu'un client existant reçoive un email
  // de prospection à froid. Tant que le classement restait invisible, il ne
  // pouvait pas le corriger. Il est désormais affiché, modifiable ligne par
  // ligne, et l'origine de chaque valeur (fichier ou proposition d'Aaron) est
  // indiquée pour qu'il sache où porter son attention.
  //
  // La proposition d'Aaron est DÉTERMINISTE, pas un appel au modèle : classer
  // « en cours » un contact dont le fichier ne dit rien n'a besoin d'aucune
  // intelligence, et Alex a demandé (01/09/2026) que rien n'augmente les coûts
  // API. C'est aussi le principe déjà posé en haut de ce fichier : on n'invente
  // jamais une donnée de contact sans relecture humaine.
  const [stageChoices, setStageChoices] = useState({});   // idx -> 'en_cours' | ... | 'client' | 'perdu' | ''
  const [stageSources, setStageSources] = useState({});   // idx -> 'file' | 'aaron'
  const [bulkStage, setBulkStage] = useState('en_cours');

  const [reviewRows, setReviewRows] = useState([]);
  const [included, setIncluded] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [junkFlags, setJunkFlags] = useState({});

  const [aiAssist, setAiAssist] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  const [autoContact, setAutoContact] = useState(false);
  const [stage, setStage] = useState(stageOrder ? stageOrder[0] : null);

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [importing, setImporting] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setTruncatedWarning(null);
    setFileName(file.name);

    // Choix CSV (recommandé) / Excel demandé par Alex (2026-08-25) : détecté
    // par l'extension du fichier déposé — pas besoin de le redemander,
    // l'utilisateur vient de choisir ce fichier précis. Si c'est un Excel,
    // Aaron le convertit lui-même (parseXlsxArrayBuffer, voir lib/xlsx-io.js)
    // vers exactement la même forme de données qu'un CSV, donc tout le reste
    // de ce composant (mapping, relecture, assistance IA) ne voit aucune
    // différence entre les deux formats.
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);

    const reader = new FileReader();
    reader.onload = async () => {
      let rows;
      try {
        rows = isExcel ? await parseXlsxArrayBuffer(reader.result) : parseCsv(String(reader.result || ''));
      } catch (err) {
        setError(t('csvImport.parseError', locale));
        return;
      }
      if (rows.length < 2) {
        setError(t('csvImport.tooFewRows', locale));
        return;
      }
      const [headerRow, ...dataRows] = rows;
      let usedRows = dataRows;
      if (dataRows.length > MAX_ROWS) {
        usedRows = dataRows.slice(0, MAX_ROWS);
        setTruncatedWarning(t('csvImport.truncatedWarning', locale).replace('{max}', String(MAX_ROWS)));
      }
      setHeaders(headerRow);
      setRawRows(usedRows);
      setMapping(autoMapColumns(headerRow));
      setStep('map');
    };
    reader.onerror = () => setError(t('csvImport.parseError', locale));
    if (isExcel) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  // Le classement n'est affiché que là où il a un sens : en réactivation (le
  // fichier contient par nature un mélange d'anciens clients, d'opportunités
  // mortes et de prospects jamais relancés), ou dès que le fichier comporte
  // une colonne « Progression ». Partout ailleurs, le comportement de l'import
  // reste STRICTEMENT celui d'avant cette modification.
  const showStageColumn = context === 'reactivation' || mapping.pipeline_stage !== null && mapping.pipeline_stage !== undefined;

  // Proposition d'Aaron quand le fichier ne dit rien. En réactivation et en
  // prospection, « en cours » : un contact dont on ne sait rien est un contact
  // à (re)contacter, jamais un client — se tromper dans ce sens-là est sans
  // conséquence, l'inverse enverrait un email à froid à un client.
  // En Opportunités/Clients, la colonne n'apparaît que si le fichier la
  // contient : les lignes vides gardent alors '' = « ne pas forcer », donc le
  // comportement historique de la page.
  function proposedStage() {
    return context === 'reactivation' || context === 'prospects' ? 'en_cours' : '';
  }

  function handleMapContinue() {
    if (mapping.email === null || mapping.email === undefined) {
      setError(t('csvImport.mapEmailRequired', locale));
      return;
    }
    setError(null);
    const built = buildMappedRows(rawRows, mapping);
    setReviewRows(built);
    const initialIncluded = {};
    const initialChoices = {};
    const initialSources = {};
    built.forEach((r) => {
      initialIncluded[r.idx] = r.errors.length === 0;
      if (r.pipeline) {
        initialChoices[r.idx] = r.pipeline.lost ? 'perdu' : r.pipeline.stage;
        initialSources[r.idx] = 'file';
      } else {
        initialChoices[r.idx] = proposedStage();
        initialSources[r.idx] = 'aaron';
      }
    });
    setIncluded(initialIncluded);
    setStageChoices(initialChoices);
    setStageSources(initialSources);
    setStep('review');
    if (aiAssist) runAiAssist(built);
  }

  async function runAiAssist(rows) {
    const eligible = rows.filter((r) => r.errors.length === 0);
    if (eligible.length === 0) return;
    setAnalyzing(true);
    const batches = [];
    for (let i = 0; i < eligible.length; i += AI_BATCH_SIZE) {
      batches.push(eligible.slice(i, i + AI_BATCH_SIZE));
    }
    for (const batch of batches) {
      try {
        const res = await fetch('/api/csv-import/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            company_id: companyId,
            module,
            rows: batch.map((r) => ({ idx: r.idx, full_name: r.full_name, email: r.email, company_name: r.company_name })),
          }),
        });
        if (!res.ok) continue;
        const body = await res.json();
        const newSuggestions = {};
        const newJunk = {};
        (body.suggestions || []).forEach((s) => {
          newSuggestions[s.idx] = s;
          if (s.is_likely_junk) newJunk[s.idx] = s.junk_reason || true;
        });
        setSuggestions((prev) => ({ ...prev, ...newSuggestions }));
        if (Object.keys(newJunk).length > 0) {
          setJunkFlags((prev) => ({ ...prev, ...newJunk }));
          setIncluded((prev) => {
            const next = { ...prev };
            Object.keys(newJunk).forEach((idx) => {
              next[idx] = false;
            });
            return next;
          });
        }
        // Correction de casse : appliquée directement (purement cosmétique,
        // ne change jamais le contenu du nom) ; la suggestion de nom
        // d'entreprise, elle, reste affichée sans être pré-remplie de force
        // — voir le badge "✨" à côté du champ dans le tableau de relecture.
        setReviewRows((prev) =>
          prev.map((r) => {
            const s = newSuggestions[r.idx];
            if (s && s.full_name_fix && s.full_name_fix !== r.full_name) {
              return { ...r, full_name: s.full_name_fix };
            }
            return r;
          })
        );
      } catch (err) {
        // Best-effort : un lot raté n'empêche pas l'import, ni l'analyse des
        // lots suivants.
      }
    }
    setAnalyzing(false);
  }

  function updateRow(idx, field, value) {
    setReviewRows((prev) =>
      prev.map((r) => {
        if (r.idx !== idx) return r;
        const updated = { ...r, [field]: value };
        const errors = [];
        if (!updated.full_name || !updated.full_name.trim()) errors.push('Nom manquant');
        if (!updated.email || !updated.email.trim()) errors.push('Email manquant');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updated.email.trim())) errors.push('Email invalide');
        return { ...updated, errors };
      })
    );
  }

  function acceptCompanySuggestion(idx, suggestion) {
    updateRow(idx, 'company_name', suggestion);
  }

  function toggleIncluded(idx) {
    setIncluded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  // Trois origines possibles pour le classement d'une ligne :
  //   'file'  — la valeur vient de la colonne « Progression » du fichier
  //   'user'  — le commercial l'a choisie lui-même (ligne par ligne ou en lot)
  //   'aaron' — simple proposition par défaut, jamais confirmée par un humain
  function setStageChoice(idx, value) {
    setStageChoices((prev) => ({ ...prev, [idx]: value }));
    setStageSources((prev) => ({ ...prev, [idx]: 'user' }));
  }

  // L'action groupée ne touche jamais aux valeurs venues du fichier : celles-là
  // sont une information explicite du commercial, pas une case à remplir.
  function applyBulkStage() {
    const targets = reviewRows.filter((r) => stageSources[r.idx] !== 'file').map((r) => r.idx);
    setStageChoices((prev) => {
      const next = { ...prev };
      targets.forEach((idx) => {
        next[idx] = bulkStage;
      });
      return next;
    });
    setStageSources((prev) => {
      const next = { ...prev };
      targets.forEach((idx) => {
        next[idx] = 'user';
      });
      return next;
    });
  }

  // Étape effective envoyée à l'import. Hors des contextes où la colonne est
  // affichée, on retombe exactement sur l'ancien comportement (row.pipeline).
  //
  // ATTENTION — subtilité qui a bien failli coûter cher : écrire
  // prospects.pipeline_stage FIGE l'étape. derivePipelinePosition() (lib/
  // pipeline.ts) donne la priorité absolue à cette colonne sur l'étape déduite
  // du comportement réel. Un contact importé avec pipeline_stage = 'en_cours'
  // resterait donc affiché « En cours » POUR TOUJOURS, même après avoir
  // répondu, décroché un RDV ou demandé un devis.
  //
  // On ne force donc l'étape que lorsqu'un humain l'a réellement décidée :
  // valeur lue dans le fichier, ou choisie dans ce tableau. Une proposition
  // d'Aaron laissée telle quelle n'écrit rien — le contact suit la déduction
  // automatique, ce qui donne de toute façon « en cours » au départ, mais le
  // laisse évoluer normalement.
  function effectivePipeline(row) {
    if (!showStageColumn) return row.pipeline;
    if (stageSources[row.idx] === 'aaron') return null;
    const choice = stageChoices[row.idx];
    if (!choice) return null;
    return choice === 'perdu' ? { stage: 'en_cours', lost: true } : { stage: choice, lost: false };
  }

  const includedRows = reviewRows.filter((r) => included[r.idx] && r.errors.length === 0);
  const invalidCount = reviewRows.filter((r) => r.errors.length > 0).length;

  // Récapitulatif affiché juste au-dessus du bouton d'import : le commercial
  // doit voir en une ligne combien de clients / opportunités / prospects /
  // perdus il s'apprête à confier à Aaron, sans relire tout le tableau.
  const stageRecap = (() => {
    if (!showStageColumn) return [];
    const counts = {};
    includedRows.forEach((r) => {
      const choice = stageChoices[r.idx] || '';
      counts[choice] = (counts[choice] || 0) + 1;
    });
    const lines = PIPELINE_STAGES.filter((st) => counts[st.key]).map((st) => ({
      key: st.key,
      icon: CATEGORY_ICONS[st.category],
      label: t(st.labelKey, locale),
      count: counts[st.key],
    }));
    if (counts.perdu) lines.push({ key: 'perdu', icon: <Ic name="x" />, label: t('pipeline.lostLabel', locale), count: counts.perdu });
    if (counts['']) lines.push({ key: 'none', icon: '·', label: t('csvImport.stageKeepDefault', locale), count: counts[''] });
    return lines;
  })();

  async function handleImport() {
    setImporting(true);
    setStep('importing');
    setProgress({ done: 0, total: includedRows.length });
    const rowResults = [];

    // Docx pipeline "Réactivation" (Alex, 2026-08-23) : un seul lot tracé par
    // fichier déposé (pas un par ligne) — la confirmation "je confirme
    // donner à Aaron la prise en charge de ce fichier" a déjà été cochée à
    // ce stade (bouton Importer désactivé sinon, voir plus bas).
    let reactivationBatchId = null;
    if (context === 'reactivation') {
      try {
        const batchRes = await fetch('/api/reactivation/batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyId,
            uploaded_by_user_id: userId,
            file_name: fileName || 'fichier de réactivation',
            row_count: includedRows.length,
          }),
        });
        const batchBody = await batchRes.json();
        if (batchRes.ok) reactivationBatchId = batchBody.batch.id;
      } catch (err) {
        // Best-effort : même si la création du lot échoue, on ne bloque pas
        // la réactivation elle-même — les prospects seront juste créés sans
        // reactivation_batch_id (origin reste correctement 'reactive_par_aaron').
      }
    }

    for (const row of includedRows) {
      // 'reactivation' : Aaron contacte toujours automatiquement (pas de
      // choix laissé, cohérent avec "Aaron doit soulager le commercial, pas
      // lui imposer des contraintes" — voir doc pipeline). 'prospects' :
      // choix du commercial via la case à cocher. Sinon (sales/customer) :
      // jamais de 1er email à froid (relation déjà établie).
      let skipFirstContact = context === 'reactivation' ? false : context === 'prospects' ? !autoContact : true;
      // Colonne « Progression » du fichier (demande Alex, 01/09/2026) : un
      // contact importé comme CLIENT ne doit jamais recevoir d'email de
      // prospection à froid, quel que soit le contexte d'import — c'est
      // l'accident que le commercial redoute le plus en déposant sa base.
      // Un contact importé comme PERDU n'est pas recontacté non plus par cet
      // import : il est enregistré tel quel, et c'est la réactivation qui
      // décidera plus tard de le relancer.
      const pipe = effectivePipeline(row);
      if (pipe && (pipe.stage === 'client' || pipe.lost)) {
        skipFirstContact = true;
      }
      try {
        const res = await fetch('/api/prospects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyId,
            assigned_user_id: userId,
            full_name: row.full_name,
            email: row.email,
            phone: row.phone || null,
            job_title: row.job_title || null,
            company_name: row.company_name || null,
            skip_first_contact: skipFirstContact,
            origin: context === 'reactivation' ? 'reactive_par_aaron' : undefined,
            reactivation_batch_id: reactivationBatchId,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          rowResults.push({ idx: row.idx, full_name: row.full_name, success: false, error: body.error || 'Erreur inconnue' });
        } else {
          let patchError = null;
          // L'étape lue dans le fichier prime sur l'étape déduite du
          // contexte d'import : elle vient explicitement du commercial.
          if (pipe) {
            const patchBody = pipe.lost
              ? { action: 'marquer_perdu', lost_reason: 'autre' }
              : { action: 'set_pipeline_stage', stage: pipe.stage };
            const patchRes = await fetch(`/api/prospects/${body.prospect.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patchBody),
            });
            if (!patchRes.ok) patchError = (await patchRes.json()).error || 'Erreur inconnue';
          } else if (context === 'sales') {
            const patchRes = await fetch(`/api/prospects/${body.prospect.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'set_deal_stage', deal_stage: stage }),
            });
            if (!patchRes.ok) patchError = (await patchRes.json()).error || 'Erreur inconnue';
          } else if (context === 'customer') {
            const patchRes = await fetch(`/api/prospects/${body.prospect.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'marquer_gagne', first_order_confirmed: true }),
            });
            if (!patchRes.ok) patchError = (await patchRes.json()).error || 'Erreur inconnue';
          }
          rowResults.push({
            idx: row.idx,
            full_name: row.full_name,
            success: !patchError,
            error: patchError,
            emailWarning: body.emailWarning || null,
          });
        }
      } catch (err) {
        rowResults.push({ idx: row.idx, full_name: row.full_name, success: false, error: err.message || 'Erreur réseau' });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setResults(rowResults);
    setImporting(false);
    setStep('done');
  }

  function handleFinish() {
    const successCount = results.filter((r) => r.success).length;
    onImported(successCount);
    onClose();
  }

  const successCount = results.filter((r) => r.success).length;
  const failedResults = results.filter((r) => !r.success);
  const emailWarningCount = results.filter((r) => r.success && r.emailWarning).length;

  return (
    <div className="overlay" onClick={step === 'importing' ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t(context === 'reactivation' ? 'csvImport.reactivationTitle' : 'csvImport.title', locale)}</h2>

        {step === 'upload' && (
          <>
            <p className="hint">
              {t(context === 'reactivation' ? 'csvImport.reactivationUploadHint' : 'csvImport.uploadHint', locale)}
            </p>
            <label className="file-drop">
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={handleFile}
              />
              {t('csvImport.chooseFile', locale)}
            </label>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                {t('common.cancel', locale)}
              </button>
            </div>
          </>
        )}

        {step === 'map' && (
          <>
            <p className="hint">{t('csvImport.mapHint', locale)}</p>
            {truncatedWarning && <p className="warning">{truncatedWarning}</p>}
            <div className="map-grid">
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="map-row">
                  {t(FIELD_LABEL_KEYS[field], locale)}
                  <select
                    value={mapping[field] === null || mapping[field] === undefined ? '' : mapping[field]}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [field]: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                  >
                    <option value="">{t('csvImport.mapNotMapped', locale)}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Colonne ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => setStep('upload')}>
                {t('csvImport.backButton', locale)}
              </button>
              <button type="button" className="btn-primary" onClick={handleMapContinue}>
                {t('csvImport.continueButton', locale)}
              </button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <p className="hint">{t('csvImport.reviewHint', locale)}</p>
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={aiAssist}
                disabled={analyzing}
                onChange={(e) => {
                  setAiAssist(e.target.checked);
                  if (e.target.checked) runAiAssist(reviewRows);
                }}
              />
              {t('csvImport.aiAssistLabel', locale)}
            </label>
            {analyzing && <p className="hint small">{t('csvImport.aiAssistRunning', locale)}</p>}
            {invalidCount > 0 && (
              <p className="warning">{t('csvImport.invalidRowsTitle', locale).replace('{n}', String(invalidCount))}</p>
            )}

            {showStageColumn && (
              <div className="stage-toolbar">
                <p className="hint small">{t('csvImport.stageColumnHint', locale)}</p>
                <div className="stage-bulk">
                  <label>
                    {t('csvImport.stageBulkLabel', locale)}
                    <select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}>
                      {PIPELINE_STAGES.map((st) => (
                        <option key={st.key} value={st.key}>
                          {CATEGORY_ICONS[st.category]} {t(st.labelKey, locale)}
                        </option>
                      ))}
                      <option value="perdu">{t('pipeline.lostLabel', locale)}</option>
                    </select>
                  </label>
                  <button type="button" className="btn-secondary small" onClick={applyBulkStage}>
                    {t('csvImport.stageBulkApply', locale)}
                  </button>
                </div>
              </div>
            )}

            <div className="review-table-wrap">
              <table className="review-table">
                <thead>
                  <tr>
                    <th />
                    <th>{t('csvImport.mapFieldFullName', locale)}</th>
                    <th>{t('csvImport.mapFieldEmail', locale)}</th>
                    <th>{t('csvImport.mapFieldCompany', locale)}</th>
                    <th>{t('csvImport.mapFieldJobTitle', locale)}</th>
                    {showStageColumn && <th>{t('csvImport.stageColumn', locale)}</th>}
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((row) => {
                    const suggestion = suggestions[row.idx];
                    const isJunk = !!junkFlags[row.idx];
                    const hasError = row.errors.length > 0;
                    return (
                      <tr key={row.idx} className={hasError ? 'row-error' : isJunk ? 'row-junk' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!included[row.idx] && !hasError}
                            disabled={hasError}
                            onChange={() => toggleIncluded(row.idx)}
                          />
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            value={row.full_name}
                            onChange={(e) => updateRow(row.idx, 'full_name', e.target.value)}
                          />
                          {hasError && <span className="row-note error">{row.errors.join(' · ')}</span>}
                          {isJunk && !hasError && (
                            <span className="row-note junk" title={typeof junkFlags[row.idx] === 'string' ? junkFlags[row.idx] : ''}>
                              {t('csvImport.junkBadge', locale)}
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            value={row.email}
                            onChange={(e) => updateRow(row.idx, 'email', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            value={row.company_name}
                            onChange={(e) => updateRow(row.idx, 'company_name', e.target.value)}
                          />
                          {suggestion?.company_name_suggestion && !row.company_name && (
                            <button
                              type="button"
                              className="suggestion-chip"
                              onClick={() => acceptCompanySuggestion(row.idx, suggestion.company_name_suggestion)}
                            >
                              <Ic name="sparkles" size={12} /> {suggestion.company_name_suggestion}
                            </button>
                          )}
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            value={row.job_title}
                            onChange={(e) => updateRow(row.idx, 'job_title', e.target.value)}
                          />
                        </td>
                        {showStageColumn && (
                          <td>
                            <select
                              className="cell-input stage-select"
                              value={stageChoices[row.idx] || ''}
                              onChange={(e) => setStageChoice(row.idx, e.target.value)}
                            >
                              {proposedStage() === '' && <option value="">{t('csvImport.stageKeepDefault', locale)}</option>}
                              {PIPELINE_STAGES.map((st) => (
                                <option key={st.key} value={st.key}>
                                  {CATEGORY_ICONS[st.category]} {t(st.labelKey, locale)}
                                </option>
                              ))}
                              <option value="perdu">{t('pipeline.lostLabel', locale)}</option>
                            </select>
                            {stageSources[row.idx] === 'aaron' && (
                              <span className="row-note stage-aaron"><Ic name="sparkles" size={12} /> {t('csvImport.stageFromAaron', locale)}</span>
                            )}
                            {stageSources[row.idx] === 'file' && (
                              <span className="row-note stage-file">{t('csvImport.stageFromFile', locale)}</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {context === 'prospects' && (
              <label className="ai-toggle">
                <input type="checkbox" checked={autoContact} onChange={(e) => setAutoContact(e.target.checked)} />
                {t('csvImport.autoContactLabel', locale)}
              </label>
            )}
            {context === 'prospects' && <p className="hint small">{t('csvImport.autoContactHint', locale)}</p>}

            {showStageColumn && includedRows.length > 0 && (
              <div className="stage-recap">
                <strong>{t('csvImport.stageRecapTitle', locale)}</strong>
                <ul>
                  {stageRecap.map((line) => (
                    <li key={line.key}>
                      {line.icon} {line.label} — <b>{line.count}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {context === 'reactivation' && (
              <>
                <p className="hint small">{t('csvImport.reactivationAutoContactHint', locale)}</p>
                <label className="ai-toggle">
                  <input
                    type="checkbox"
                    checked={reactivationConfirmed}
                    onChange={(e) => setReactivationConfirmed(e.target.checked)}
                  />
                  {t('csvImport.reactivationConfirmLabel', locale)}
                </label>
              </>
            )}

            {context === 'sales' && stageOrder && (
              <label className="map-row">
                {t('csvImport.stageLabel', locale)}
                <select value={stage} onChange={(e) => setStage(e.target.value)}>
                  {stageOrder.map((s) => (
                    <option key={s} value={s}>
                      {stageMeta[s].label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => setStep('map')}>
                {t('csvImport.backButton', locale)}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={includedRows.length === 0 || (context === 'reactivation' && !reactivationConfirmed)}
                onClick={handleImport}
              >
                {t('csvImport.importButton', locale).replace('{n}', String(includedRows.length))}
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <>
            <p className="hint">{t('csvImport.importingTitle', locale)}</p>
            <p className="hint small">{t('csvImport.importingHint', locale)}</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }}
              />
            </div>
            <p className="hint small">{progress.done} / {progress.total}</p>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="hint">{t('csvImport.doneTitle', locale)}</p>
            <p className="hint">
              {t('csvImport.doneSummary', locale).replace('{success}', String(successCount)).replace('{failed}', String(failedResults.length))}
            </p>
            {emailWarningCount > 0 && (
              <p className="warning">{t('csvImport.emailWarningSummary', locale).replace('{n}', String(emailWarningCount))}</p>
            )}
            {failedResults.length > 0 && (
              <div className="failed-list">
                {failedResults.map((r) => (
                  <p key={r.idx} className="row-note error">
                    {r.full_name} — {r.error}
                  </p>
                ))}
              </div>
            )}
            <div className="actions">
              <button type="button" className="btn-primary" onClick={handleFinish}>
                {t('csvImport.finishButton', locale)}
              </button>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 1.8rem;
          width: 720px;
          max-width: 100%;
          max-height: 88vh;
          overflow-y: auto;
        }
        h2 {
          font-family: var(--font-display);
          margin: 0 0 0.6rem;
        }
        .hint {
          color: var(--muted);
          font-size: 0.85rem;
          margin: 0 0 1rem;
          line-height: 1.4;
        }
        .hint.small {
          font-size: 0.76rem;
          margin: 0.3rem 0 1rem;
        }
        .warning {
          color: #F0C94E;
          font-size: 0.8rem;
          margin: 0 0 1rem;
        }
        .error {
          color: var(--accent-red);
          font-size: 0.82rem;
          margin: 0.4rem 0;
        }
        .file-drop {
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px dashed var(--border);
          border-radius: var(--radius-md);
          padding: 2rem 1rem;
          color: var(--accent);
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 1rem;
        }
        .file-drop input {
          display: none;
        }
        .map-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.8rem 1.2rem;
          margin-bottom: 1rem;
        }
        .map-row {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.82rem;
          color: var(--muted);
        }
        .map-row select {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.5rem 0.7rem;
          color: var(--text);
          font-size: 0.85rem;
        }
        .ai-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.84rem;
          color: var(--text);
          margin-bottom: 0.3rem;
        }
        .review-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          margin-bottom: 1rem;
        }
        .review-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }
        .review-table th {
          text-align: left;
          padding: 0.6rem 0.7rem;
          color: var(--muted);
          font-weight: 600;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .review-table td {
          padding: 0.5rem 0.7rem;
          border-bottom: 1px solid var(--border);
          vertical-align: top;
        }
        .review-table tr.row-error {
          background: rgba(229, 72, 77, 0.06);
        }
        .review-table tr.row-junk {
          background: rgba(240, 201, 78, 0.06);
        }
        .cell-input {
          width: 100%;
          min-width: 110px;
          box-sizing: border-box;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.35rem 0.5rem;
          color: var(--text);
          font-size: 0.8rem;
        }
        .row-note {
          display: block;
          font-size: 0.7rem;
          margin-top: 0.25rem;
        }
        .row-note.error {
          color: var(--accent-red);
        }
        .row-note.junk {
          color: #F0C94E;
        }
        .suggestion-chip {
          display: block;
          margin-top: 0.3rem;
          background: none;
          border: 1px dashed var(--accent);
          color: var(--accent);
          border-radius: var(--radius-sm);
          padding: 0.2rem 0.5rem;
          font-size: 0.7rem;
          cursor: pointer;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .progress-bar {
          height: 8px;
          background: var(--bg);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 0.4rem;
        }
        .progress-fill {
          height: 100%;
          background: var(--accent);
          transition: width 0.2s ease;
        }
        .failed-list {
          max-height: 160px;
          overflow-y: auto;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          margin-bottom: 1rem;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 1.2rem;
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .btn-secondary {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: var(--radius-sm);
          padding: 0.6rem 1rem;
          cursor: pointer;
        }
        .btn-secondary.small {
          padding: 0.35rem 0.7rem;
          font-size: 0.75rem;
        }
        .stage-toolbar {
          margin: 0.6rem 0 0.4rem;
        }
        .stage-bulk {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
          margin-top: 0.4rem;
        }
        .stage-bulk label {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.75rem;
          color: var(--muted);
          flex-wrap: wrap;
        }
        .stage-bulk select {
          background: var(--surface-2, transparent);
          border: 1px solid var(--border);
          color: var(--text);
          border-radius: var(--radius-sm);
          padding: 0.3rem 0.5rem;
          font-size: 0.75rem;
        }
        .stage-select {
          min-width: 11rem;
        }
        .row-note.stage-aaron {
          color: var(--accent);
        }
        .row-note.stage-file {
          color: var(--muted);
        }
        .stage-recap {
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 0.6rem 0.8rem;
          margin: 0.8rem 0 0.4rem;
          font-size: 0.8rem;
        }
        .stage-recap ul {
          list-style: none;
          margin: 0.4rem 0 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem 1rem;
        }
        .stage-recap li {
          color: var(--muted);
        }
        .stage-recap b {
          color: var(--text);
        }
      `}</style>
    </div>
  );
}
