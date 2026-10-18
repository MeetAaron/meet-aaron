// lib/news-triggers.ts
// « Déclencheurs d'actualité » (validé par Alex le 18/10/2026).
//
// Un prospect qui n'a jamais répondu à trois emails est classé « sans
// réponse » et Aaron le laisse tranquille — à raison : insister sans rien
// de neuf à dire, c'est du spam. Mais quand il se passe quelque chose chez
// lui (il recrute, ouvre une agence, change de dirigeant, lève des fonds,
// lance un produit, reçoit un prix), on a enfin une vraie raison d'écrire,
// et c'est le moment où il est le plus réceptif : un besoin apparaît.
//
// Ce module, lancé chaque matin de semaine :
//   1. prend les prospects classés « sans réponse » depuis 2 semaines à
//      6 mois (le temps que la poussière retombe, pas si vieux que la
//      campagne soit oubliée), toujours gérés par Aaron, sans proposition
//      déjà en attente, jamais relancés sur une actualité ce trimestre ;
//   2. une recherche web par SOCIÉTÉ (Haiku + web_search, comme la recherche
//      métier de lib/prospect-research.ts), au plus une fois par mois par
//      société, résultat mémorisé dans prospect_companies ;
//   3. si une actualité récente et vérifiable sort, rédige une relance courte
//      qui part de CETTE actualité et la range dans rescue_proposal_* avec
//      rescue_proposal_source = 'actualite' : le commercial la voit dans
//      « À valider » (story « Sauvetage à valider », fiche du tableau de
//      bord), la lit, l'envoie ou l'écarte. RIEN NE PART SANS LUI — c'est
//      la règle du sauvetage depuis le début, et une relance après six mois
//      de silence est exactement le type d'email qu'on ne veut pas
//      automatiser à l'aveugle.
// À l'approbation (app/api/prospects/[id], approuver_sauvetage), le
// prospect sort du statut « perdu sans réponse » et repasse en jaune : la
// conversation est rouverte, check-inbox et les relances reprennent.
//
// Garde-fous de coût : MAX_SEARCHES_PER_RUN recherches par passage, et une
// société n'est re-vérifiée que si news_checked_at date d'au moins
// RECHECK_DAYS. Avec 300 prospects « sans réponse » par compte, ça fait
// quelques recherches Haiku par jour et par compte — négligeable.

import { supabaseAdmin } from './supabase-admin';
import { callClaude, MonthlyCapExceededError } from './anthropic-client';
import { localeInstruction, normalizeLocale } from './locale-instruction';
import { sendPushNotification } from './push';
import { extractJsonObject } from './extract-json';

export const LOST_MIN_DAYS = 14;
export const LOST_MAX_DAYS = 180;
export const RECHECK_DAYS = 30;
export const PROPOSAL_COOLDOWN_DAYS = 90;
export const NEWS_MAX_AGE_DAYS = 90;
// 60 s de fonction Vercel : ~6 recherches web Haiku (5 à 8 s chacune) et
// quelques rédactions tiennent dedans. Le reste attend le lendemain — les
// sociétés déjà contrôlées sont sautées, donc on avance chaque jour.
const MAX_SEARCHES_PER_RUN = 6;
const TIME_BUDGET_MS = 45_000;
const MAX_PROPOSALS_PER_USER_PER_RUN = 3;

export interface NewsSignal {
  signal: string; // une phrase factuelle
  url: string | null;
  date: string | null; // ISO ou texte libre renvoyé par la recherche
}

interface CompanyRow {
  id: string;
  company_id: string | null;
  name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  address: string | null;
  news_signal: string | null;
  news_signal_url: string | null;
  news_signal_at: string | null;
  news_checked_at: string | null;
}

// Une recherche web, une réponse JSON, zéro invention : chaque champ est
// null plutôt que deviné. On exige une actualité datée des 3 derniers mois
// et propre à CETTE société (pas un homonyme, pas une tendance du secteur).
export async function findNewsSignal(company: CompanyRow, now: Date = new Date()): Promise<NewsSignal | null> {
  const identifiers = [
    company.name ? `Nom de la société : ${company.name}` : null,
    company.website ? `Site web : ${company.website}` : company.domain ? `Domaine : ${company.domain}` : null,
    company.industry ? `Activité : ${company.industry}` : null,
    company.address ? `Adresse : ${company.address}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  if (!company.name && !company.website && !company.domain) return null;

  const prompt =
    `Nous sommes le ${now.toISOString().slice(0, 10)}. Cherche sur le web une ACTUALITÉ RÉCENTE (moins de ${NEWS_MAX_AGE_DAYS} jours) ` +
    `et publique concernant précisément cette entreprise :\n\n${identifiers}\n\n` +
    `Ce qui compte comme actualité : recrutement en cours (offres d'emploi), ouverture d'une agence ou d'un point de vente, ` +
    `déménagement, nouveau dirigeant ou nouvel associé, levée de fonds, rachat ou fusion, lancement d'un produit ou service, ` +
    `nouveau site web, prix ou label obtenu, gros chantier ou contrat annoncé, passage dans la presse locale, anniversaire d'entreprise.\n` +
    `Ce qui NE compte PAS : une tendance générale du secteur, une actualité d'une société homonyme ou d'un groupe différent, ` +
    `une page « à propos » sans date, un avis client, une information datant de plus de ${NEWS_MAX_AGE_DAYS} jours.\n\n` +
    `Réponds UNIQUEMENT avec un objet JSON (sans texte avant/après, sans balises markdown) :\n` +
    `{\n` +
    `  "signal": "UNE phrase factuelle et datable qui décrit l'actualité (ex: « recrute un technicien de maintenance depuis début octobre », ` +
    `« a ouvert une seconde agence à Villeurbanne en septembre »), ou null si rien de récent et de sûr",\n` +
    `  "url": "URL de la source ou null",\n` +
    `  "date": "date de l'actualité au format AAAA-MM-JJ si connue, sinon AAAA-MM, sinon null"\n` +
    `}\n\n` +
    `N'INVENTE RIEN : en cas de doute sur la société ou sur la date, renvoie signal = null.`;

  try {
    const data = await callClaude(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        messages: [{ role: 'user', content: prompt }],
      },
      company.company_id,
      'ap'
    );
    const textBlock = data.content.filter((b: any) => b.type === 'text').pop();
    const text = textBlock?.text?.trim();
    if (!text) return null;
    let parsed: any;
    try {
      parsed = extractJsonObject(text);
    } catch {
      return null;
    }
    const signal = typeof parsed?.signal === 'string' && parsed.signal.trim() && parsed.signal.trim().toLowerCase() !== 'null' ? parsed.signal.trim() : null;
    if (!signal) return null;
    const date = typeof parsed?.date === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(parsed.date.trim()) ? parsed.date.trim() : null;
    // Date connue et trop ancienne : on la refuse même si le modèle l'a jugée « récente ».
    if (date) {
      const d = new Date(date.length === 7 ? `${date}-01` : date);
      if (!Number.isNaN(d.getTime()) && now.getTime() - d.getTime() > (NEWS_MAX_AGE_DAYS + 31) * 86_400_000) return null;
    }
    const url = typeof parsed?.url === 'string' && /^https?:\/\//i.test(parsed.url.trim()) ? parsed.url.trim() : null;
    return { signal, url, date };
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) throw err;
    console.error('Recherche actualité société :', err?.message);
    return null;
  }
}

interface ProposalEmail { subject: string; body: string }

// La relance : courte, part de l'actualité, propose une seule chose. Pas de
// « je reviens vers vous », pas de « comme je vous l'écrivais » — on ne lui
// rappelle pas qu'il n'a jamais répondu, on lui parle de LUI.
export async function generateNewsFollowUp(prospectId: string, signal: NewsSignal): Promise<ProposalEmail | null> {
  const { data: prospect, error } = await supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, job_title, company_id, assigned_user_id, prospect_companies(name, industry, research_summary), users(locale, full_name, first_name)')
    .eq('id', prospectId)
    .single();
  if (error || !prospect) return null;
  const p: any = prospect;
  const locale = normalizeLocale(p.users?.locale);
  const sellerName = p.users?.first_name || p.users?.full_name || '';
  // Ce que vend le commercial : fiche société (Mon entreprise), comme dans lib/aaron.ts.
  const { data: company } = p.company_id
    ? await supabaseAdmin.from('companies').select('name, business_summary, prospecting_goal, prospecting_goal_details').eq('id', p.company_id).maybeSingle()
    : { data: null as any };

  const { data: conversation } = await supabaseAdmin.from('conversations').select('id').eq('prospect_id', prospectId).eq('channel', 'email').maybeSingle();
  let lastOutbound: string | null = null;
  if (conversation) {
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('direction, body')
      .eq('conversation_id', conversation.id)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: false })
      .limit(1);
    lastOutbound = msgs?.[0]?.body || null;
  }

  try {
    const data = await callClaude(
      {
        model: 'claude-sonnet-5',
        max_tokens: 350,
        messages: [
          {
            role: 'user',
            content:
              `Tu es Aaron, l'assistant commercial de ${sellerName || 'un commercial'}${company?.name ? ` (${company.name})` : ''}, et tu écris EN SON NOM (première personne, c'est lui qui signe).\n` +
              (company?.business_summary ? `Ce que vend le commercial : ${company.business_summary}\n` : '') +
              (company?.prospecting_goal_details || company?.prospecting_goal ? `Objectif de la prospection : ${company.prospecting_goal_details || company.prospecting_goal}\n` : '') +
              `Destinataire : ${p.full_name}${p.job_title ? `, ${p.job_title}` : ''}${p.prospect_companies?.name ? ` chez ${p.prospect_companies.name}` : ''}.\n` +
              (p.prospect_companies?.research_summary ? `Ce qu'on sait de sa société : ${p.prospect_companies.research_summary}\n` : '') +
              `Il a reçu plusieurs emails de prospection il y a quelques mois et n'a jamais répondu. On NE le lui rappelle PAS.\n` +
              `Actualité repérée chez lui : ${signal.signal}${signal.date ? ` (${signal.date})` : ''}.\n\n` +
              `Rédige un email court qui part de CETTE actualité (félicitations ou remarque sincère en une phrase, sans flatterie lourde), ` +
              `fait le lien en une phrase avec ce que le commercial peut lui apporter dans ce contexte précis, et termine par UNE question simple ` +
              `(un échange de 15 minutes, ou une question ouverte sur son besoin). 3 à 5 phrases. Pas de « je reviens vers vous », pas de « sans réponse de votre part », ` +
              `pas de formule marketing, pas de pièce jointe, pas de signature.\n` +
              (lastOutbound ? `Pour le ton et pour ne pas répéter les mêmes arguments, voici le dernier email envoyé :\n${lastOutbound.slice(0, 900)}\n\n` : '') +
              `Réponds UNIQUEMENT avec un objet JSON de cette forme exacte, sans texte avant/après ni balises markdown :\n` +
              `{"subject": "objet court qui mentionne l'actualité, pas « relance »", "body": "corps de l'email sans balises HTML — LANGUE : ${localeInstruction(locale)}"}`,
          },
        ],
      },
      p.company_id,
      'ap',
      p.assigned_user_id
    );
    const textBlock = data.content.find((b: any) => b.type === 'text');
    if (!textBlock) return null;
    const result = extractJsonObject<ProposalEmail>(textBlock.text);
    if (!result?.subject?.trim() || !result?.body?.trim()) return null;
    return { subject: result.subject.trim(), body: result.body.trim() };
  } catch (err: any) {
    if (err instanceof MonthlyCapExceededError) throw err;
    console.error('Génération relance actualité :', err?.message);
    return null;
  }
}

export interface NewsTriggerReport {
  candidates: number;
  searches: number;
  signals_found: number;
  proposals: number;
  errors: { prospect_id?: string; company: string; error: string }[];
}

// Appelé par app/api/cron/news-triggers (chaque matin de semaine).
export async function runNewsTriggers(now: Date = new Date(), onlyUserId?: string | null): Promise<NewsTriggerReport> {
  const report: NewsTriggerReport = { candidates: 0, searches: 0, signals_found: 0, proposals: 0, errors: [] };
  const lostBefore = new Date(now.getTime() - LOST_MIN_DAYS * 86_400_000).toISOString();
  const lostAfter = new Date(now.getTime() - LOST_MAX_DAYS * 86_400_000).toISOString();
  const cooldown = new Date(now.getTime() - PROPOSAL_COOLDOWN_DAYS * 86_400_000).toISOString();

  let q = supabaseAdmin
    .from('prospects')
    .select('id, full_name, email, assigned_user_id, company_id, prospect_company_id, ai_managed, rescue_proposal_pending, news_trigger_at, lost_at, prospect_companies(id, company_id, name, domain, website, industry, address, news_signal, news_signal_url, news_signal_at, news_checked_at)')
    .eq('is_lost', true)
    .eq('pipeline_lost_reason', 'sans_reponse')
    .lte('lost_at', lostBefore)
    .gte('lost_at', lostAfter)
    .not('prospect_company_id', 'is', null)
    .or(`news_trigger_at.is.null,news_trigger_at.lt.${cooldown}`)
    .order('lost_at', { ascending: false })
    .limit(400);
  if (onlyUserId) q = q.eq('assigned_user_id', onlyUserId);
  const res: any = await q;
  if (res.error) {
    // Migration pas jouée (colonnes absentes) : rien à faire, sans bruit.
    if (res.error.code === '42703' || res.error.code === 'PGRST204') return report;
    throw new Error(res.error.message);
  }
  const rows: any[] = (res.data || []).filter((r: any) => r.email && r.ai_managed !== false && r.rescue_proposal_pending !== true && r.prospect_companies);
  report.candidates = rows.length;
  if (rows.length === 0) return report;

  // Un seul prospect par société et par passage (le premier, le plus
  // récemment perdu) : une actualité = un email, pas quatre dans la même
  // boîte.
  const byCompany = new Map<string, any>();
  for (const r of rows) {
    const key = r.prospect_companies.id;
    if (!byCompany.has(key)) byCompany.set(key, r);
  }

  const perUser: Record<string, number> = {};
  const recheckBefore = now.getTime() - RECHECK_DAYS * 86_400_000;

  const startedAt = Date.now();
  for (const r of byCompany.values()) {
    const company: CompanyRow = r.prospect_companies;
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    if ((perUser[r.assigned_user_id] || 0) >= MAX_PROPOSALS_PER_USER_PER_RUN) continue;

    let signal: NewsSignal | null = null;
    const checkedAt = company.news_checked_at ? new Date(company.news_checked_at).getTime() : 0;
    const fresh = checkedAt > recheckBefore;
    if (fresh) {
      // Résultat du mois : on le réutilise, sans nouvelle recherche. Une
      // actualité déjà exploitée pour ce prospect (news_trigger_at plus
      // récent que news_signal_at) ne resert pas.
      if (company.news_signal && company.news_signal_at && (!r.news_trigger_at || new Date(r.news_trigger_at) < new Date(company.news_signal_at))) {
        signal = { signal: company.news_signal, url: company.news_signal_url, date: null };
      } else {
        continue;
      }
    } else {
      if (report.searches >= MAX_SEARCHES_PER_RUN) break;
      // Réclamation avant recherche : deux passages concurrents ne cherchent
      // pas deux fois la même société.
      const claim = await supabaseAdmin
        .from('prospect_companies')
        .update({ news_checked_at: now.toISOString() })
        .eq('id', company.id)
        .or(`news_checked_at.is.null,news_checked_at.lt.${new Date(recheckBefore).toISOString()}`)
        .select('id')
        .maybeSingle();
      if (!claim.data) continue;
      report.searches += 1;
      try {
        signal = await findNewsSignal(company, now);
      } catch (err: any) {
        if (err instanceof MonthlyCapExceededError) {
          // Plafond IA du compte : on rend le contrôle, on passera plus tard.
          await supabaseAdmin.from('prospect_companies').update({ news_checked_at: company.news_checked_at }).eq('id', company.id);
          report.errors.push({ company: company.name || company.id, error: 'plafond IA mensuel atteint' });
          continue;
        }
        throw err;
      }
      await supabaseAdmin
        .from('prospect_companies')
        .update({
          news_signal: signal?.signal || null,
          news_signal_url: signal?.url || null,
          news_signal_at: signal ? now.toISOString() : null,
        })
        .eq('id', company.id);
      if (!signal) continue;
      report.signals_found += 1;
    }

    // Réclamation du prospect avant rédaction.
    const { data: claimed } = await supabaseAdmin
      .from('prospects')
      .update({ news_trigger_at: now.toISOString() })
      .eq('id', r.id)
      .or('rescue_proposal_pending.is.null,rescue_proposal_pending.eq.false')
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    try {
      const email = await generateNewsFollowUp(r.id, signal);
      if (!email) {
        await supabaseAdmin.from('prospects').update({ news_trigger_at: r.news_trigger_at }).eq('id', r.id);
        continue;
      }
      await supabaseAdmin
        .from('prospects')
        .update({
          rescue_proposal_subject: email.subject,
          rescue_proposal_body: email.body,
          rescue_proposal_pending: true,
          rescue_proposal_source: 'actualite',
        })
        .eq('id', r.id);
      perUser[r.assigned_user_id] = (perUser[r.assigned_user_id] || 0) + 1;
      report.proposals += 1;
      try {
        await sendPushNotification(r.assigned_user_id, {
          title: `Actualité chez ${company.name || r.full_name}`,
          body: `${signal.signal.charAt(0).toUpperCase()}${signal.signal.slice(1)}. Aaron a préparé une relance à valider.`,
          url: `/app/prospects?user_id=${r.assigned_user_id}&contact=${r.id}`,
        });
      } catch {
        // push best-effort
      }
    } catch (err: any) {
      await supabaseAdmin.from('prospects').update({ news_trigger_at: r.news_trigger_at }).eq('id', r.id);
      if (err instanceof MonthlyCapExceededError) {
        report.errors.push({ prospect_id: r.id, company: company.name || company.id, error: 'plafond IA mensuel atteint' });
        continue;
      }
      report.errors.push({ prospect_id: r.id, company: company.name || company.id, error: err?.message || String(err) });
    }
  }

  return report;
}
