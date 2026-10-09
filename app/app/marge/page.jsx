// app/app/marge/page.jsx
//
// VUE FONDATEUR — ce que chaque client rapporte, ce qu'il coûte, et où en
// est le seuil GST australien.
//
// Demande d'Alex (02/10/2026 puis 09/10/2026) : « crée une rubrique
// uniquement pour mon compte pour voir combien ils consomment de crédits —
// voir si je gagne de la marge ou non », puis « la GST, tu me le rappelleras
// quand tu verras mon chiffre d'affaires ».
//
// Cette deuxième phrase est précisément ce que cette page refuse de laisser
// dépendre d'une mémoire. L'inscription à la GST devient obligatoire dès
// 75 000 A$ de chiffre d'affaires sur 12 mois glissants, avec 21 jours pour
// s'exécuter. Un rappel qui dépend d'une question posée au bon moment n'est
// pas un rappel : le seuil est donc recalculé à chaque ouverture de l'écran,
// et affiché en haut, avant tout le reste.
//
// Réservée au compte fondateur. Le contrôle qui compte est celui de
// /api/admin/margin, côté SERVEUR — ici on se contente de ne rien afficher
// quand la route répond 403.
//
// Volontairement NON TRADUITE et non listée dans la navigation générale,
// même convention que /app/diagnostic-outlook : c'est un outil interne à un
// seul utilisateur, le traduire en sept langues serait du travail perdu.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import Ic from '@/components/UiIcon';

function useAuthedUser() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_user_id: session.user.id, email: session.user.email }),
      });
      const body = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        router.push('/login');
        return;
      }
      setUserId(body.user.id);
    }
    resolve();
    return () => { cancelled = true; };
  }, [router]);

  return userId;
}

function money(amount, symbol) {
  if (amount === null || amount === undefined) return '—';
  return `${symbol}${Number(amount).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MargePage() {
  const userId = useAuthedUser();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    // Pas de user_id en paramètre : la route lit l'utilisateur dans le
    // token de session (AuthFetchInterceptor l'attache automatiquement),
    // jamais dans l'URL — une page qui expose le chiffre d'affaires de
    // toutes les sociétés ne s'identifie pas avec un paramètre falsifiable.
    fetch('/api/admin/margin')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.status === 403) {
          setError("Cette page est réservée au compte fondateur.");
        } else if (!r.ok) {
          setError(body.error || `Erreur ${r.status}`);
        } else {
          setData(body);
        }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const gst = data?.gst;
  const stripe = data?.stripe;
  const settle = stripe?.settlement_currency || 'AUD';
  const settleSymbol = settle === 'AUD' ? 'A$' : `${settle} `;
  // Barre plafonnée à 100 % : au-delà du seuil c'est le libellé qui porte
  // l'information, pas une barre qui déborderait de sa piste.
  const gstPct = gst?.ratio === null || gst?.ratio === undefined ? 0 : Math.min(1, gst.ratio) * 100;

  const GST_TEXT = {
    ok: "Sous le seuil. Rien à faire pour l'instant.",
    warn: "Tu approches du seuil. C'est le moment de prendre rendez-vous avec un comptable, pas après.",
    due: "Seuil franchi. L'inscription à la GST est obligatoire sous 21 jours.",
  };

  return (
    <div className="page">
      <header className="head">
        <h1>Marge par client</h1>
        <p className="sub">
          Réservé à ton compte. Mois en cours{data?.year_month ? ` — ${data.year_month}` : ''}.
        </p>
      </header>

      {loading && <p className="muted">Chargement…</p>}
      {error && <p className="err"><Ic name="alert" size={16} /> {error}</p>}

      {data && (
        <>
          {/* ---------------------------------------------------------------
              SEUIL GST — en premier, avant les chiffres d'exploitation.
              C'est la seule information de cette page qui porte une échéance
              légale ; elle ne doit pas se mériter par un défilement.
          --------------------------------------------------------------- */}
          <section className={`gst gst-${gst?.level || 'unknown'}`}>
            <div className="gst-head">
              <span className="gst-icon">
                <Ic name={gst?.level === 'ok' ? 'checkCircle' : 'alert'} size={18} />
              </span>
              <div className="gst-title-wrap">
                <h2>Seuil GST — Australie</h2>
                <p className="gst-msg">
                  {gst?.level ? GST_TEXT[gst.level] : "Chiffre d'affaires Stripe illisible pour le moment."}
                </p>
              </div>
            </div>

            <div className="meter" role="img" aria-label={`${Math.round(gstPct)} % du seuil`}>
              <div className="meter-fill" style={{ width: `${gstPct}%` }} />
            </div>

            <p className="gst-nums">
              <strong>{money(gst?.rolling_12m, settleSymbol)}</strong> encaissés sur 12 mois glissants
              {' · '}seuil {money(gst?.threshold, 'A$')}
              {gst?.ratio !== null && gst?.ratio !== undefined ? ` · ${Math.round(gst.ratio * 100)} %` : ''}
            </p>
            <p className="gst-foot">
              Base : les encaissements réglés par Stripe, convertis en {settle} par Stripe au jour
              de l'encaissement. L'inscription devient aussi obligatoire si tu <em>prévois</em> de
              franchir le seuil dans les 12 mois. Je ne suis pas comptable — fais confirmer.
            </p>
          </section>

          {/* Trois chiffres, pas plus : ce qui est rentré, ce qui est sorti,
              et le nombre de clients qui paient réellement. */}
          <section className="tiles">
            <div className="tile">
              <span className="tile-label">Encaissé ce mois-ci</span>
              <span className="tile-value">{money(stripe?.month_settled, settleSymbol)}</span>
              <span className="tile-note">réel, lu chez Stripe</span>
            </div>
            <div className="tile">
              <span className="tile-label">Coût API ce mois-ci</span>
              <span className="tile-value">{money(data.totals?.cost_usd, '$')}</span>
              <span className="tile-note">{data.totals?.credits ?? 0} crédits consommés</span>
            </div>
            <div className="tile">
              <span className="tile-label">Clients abonnés</span>
              <span className="tile-value">{data.totals?.subscribed ?? 0}</span>
              <span className="tile-note">sur {data.totals?.companies ?? 0} sociétés</span>
            </div>
          </section>

          {stripe?.error && (
            <p className="err">
              <Ic name="alert" size={16} /> Stripe n'a pas pu être lu : {stripe.error}. Les coûts
              API ci-dessous restent justes ; seuls les montants encaissés manquent.
            </p>
          )}

          {/* ---------------------------------------------------------------
              Le tableau, le plus gourmand en premier. Deux colonnes de
              revenu volontairement : l'ESTIMATION (prix du plan x sièges) et
              le RÉEL encaissé. L'écart entre les deux n'est pas du bruit,
              c'est l'information — code promo, essai, impayé, exemption.
          --------------------------------------------------------------- */}
          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Sièges</th>
                  <th className="num">Attendu</th>
                  <th className="num">Encaissé</th>
                  <th className="num">Coût API</th>
                  <th className="num">Crédits</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows || []).map((r) => (
                  <tr key={r.company_id}>
                    <td>
                      <span className="cname">{r.name}</span>
                      {!r.subscribed && <span className="chip">pas d'abonnement</span>}
                    </td>
                    <td className="num">{r.seats}</td>
                    <td className="num">{money(r.revenue_month, r.currency_symbol)}</td>
                    <td className="num">{money(r.real_revenue_month, stripe?.invoice_currency === 'EUR' ? '€' : r.currency_symbol)}</td>
                    <td className="num">{money(r.cost_usd_month, '$')}</td>
                    <td className="num">{r.credits_month}</td>
                  </tr>
                ))}
                {(data.rows || []).length === 0 && (
                  <tr><td colSpan={6} className="muted">Aucune société.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <p className="foot">
            « Attendu » est une estimation : prix du plan × nombre de sièges, plus les boosts du
            mois. « Encaissé » est ce que Stripe a réellement reçu. Le coût API est en dollars et
            le prix dans la devise du client : aucune conversion n'est appliquée, parce qu'un taux
            de change figé dans le code donnerait une marge fausse avec trois décimales de
            précision apparente.
          </p>
        </>
      )}

      <style jsx>{`
        .page {
          max-width: 980px;
          margin: 0 auto;
          padding: 1.6rem 1rem 4rem;
          color: var(--text);
          font-family: var(--font-body);
          min-width: 0;
        }
        .head h1 {
          font-family: var(--font-display);
          font-size: 1.5rem;
          margin: 0 0 0.2rem;
        }
        .sub, .muted {
          color: var(--muted);
          font-size: 0.85rem;
          margin: 0;
        }
        .err {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          color: var(--accent-red);
          font-size: 0.86rem;
          margin: 1rem 0;
        }

        .gst {
          margin-top: 1.4rem;
          padding: 1.05rem 1.1rem;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border);
          background: var(--surface);
          min-width: 0;
        }
        .gst-head {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 0.7rem;
          align-items: start;
        }
        .gst-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 11px;
          flex-shrink: 0;
        }
        .gst-title-wrap { min-width: 0; }
        .gst h2 {
          font-family: var(--font-display);
          font-size: 1rem;
          margin: 0 0 0.15rem;
        }
        .gst-msg {
          margin: 0;
          font-size: 0.86rem;
          line-height: 1.45;
        }
        /* Le statut n'est JAMAIS porté par la seule couleur : l'icône change,
           et la phrase dit explicitement quoi faire. */
        .gst-ok .gst-icon { background: rgba(61, 214, 140, 0.15); color: var(--accent-green); }
        .gst-ok .gst-msg { color: var(--muted); }
        .gst-warn { border-color: rgba(245, 166, 35, 0.45); }
        .gst-warn .gst-icon { background: rgba(245, 166, 35, 0.16); color: var(--accent-amber); }
        .gst-warn .gst-msg { color: var(--accent-amber); }
        .gst-due { border-color: rgba(239, 68, 89, 0.5); }
        .gst-due .gst-icon { background: rgba(239, 68, 89, 0.16); color: var(--accent-red); }
        .gst-due .gst-msg { color: var(--accent-red); }
        .gst-unknown .gst-icon { background: var(--tint-7); color: var(--muted); }
        .gst-unknown .gst-msg { color: var(--muted); }

        .meter {
          margin: 0.9rem 0 0.6rem;
          height: 8px;
          border-radius: 999px;
          background: var(--tint-7);
          overflow: hidden;
        }
        .meter-fill {
          height: 100%;
          border-radius: 999px;
          background: var(--accent-green);
          transition: width 0.3s var(--ease);
        }
        .gst-warn .meter-fill { background: var(--accent-amber); }
        .gst-due .meter-fill { background: var(--accent-red); }

        .gst-nums {
          margin: 0;
          font-size: 0.88rem;
          color: var(--text);
        }
        .gst-foot {
          margin: 0.5rem 0 0;
          font-size: 0.76rem;
          line-height: 1.45;
          color: var(--muted);
        }

        .tiles {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
          gap: 0.7rem;
          margin-top: 1rem;
        }
        .tile {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          padding: 0.9rem 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
          min-width: 0;
        }
        .tile-label { font-size: 0.76rem; color: var(--muted); }
        .tile-value {
          font-family: var(--font-display);
          font-size: 1.35rem;
          font-weight: 600;
          line-height: 1.2;
        }
        .tile-note { font-size: 0.74rem; color: var(--muted); }

        .table-wrap {
          margin-top: 1.2rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
          overflow-x: auto;
        }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        th, td {
          padding: 0.6rem 0.8rem;
          text-align: left;
          white-space: nowrap;
          border-bottom: 1px solid var(--border-soft);
        }
        th {
          font-size: 0.74rem;
          font-weight: 600;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        tbody tr:last-child td { border-bottom: none; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .cname { font-weight: 600; }
        .chip {
          display: inline-block;
          margin-left: 0.45rem;
          padding: 1px 7px;
          border-radius: 999px;
          font-size: 0.68rem;
          color: var(--muted);
          background: var(--tint-7);
        }
        .foot {
          margin-top: 0.9rem;
          font-size: 0.76rem;
          line-height: 1.5;
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}
