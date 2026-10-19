'use client';

// components/MfaSettings.jsx
// DOUBLE AUTHENTIFICATION (TOTP) — CASA 3.3.1, 19/10/2026.
//
// Les interfaces d'administration (compte fondateur : marge, coûts API de
// toutes les sociétés) exigent désormais une session de niveau aal2, c'est-
// à-dire un mot de passe PLUS un code à six chiffres d'une application
// d'authentification (Google Authenticator, 1Password, Authy…). Voir
// lib/auth-helpers.ts (requireMfa) et app/api/admin/margin/route.ts.
//
// Tout passe par Supabase Auth MFA (TOTP) : l'enrôlement renvoie un QR
// code, un premier code vérifie le facteur, et chaque connexion suivante
// demande le code (app/login/page.jsx). Pour tous les autres comptes,
// c'est une option recommandée, activable ici.
//
// Textes dans un dictionnaire local (lib/i18n.js est trop gros pour l'envoi
// web GitHub).

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import Ic from '@/components/UiIcon';

const TEXT = {
  fr: { title: 'Double authentification', requiredBadge: 'Obligatoire pour ce compte', on: 'Activée', off: 'Désactivée', intro: "Un code à six chiffres, généré par une application d'authentification sur ton téléphone, est demandé en plus du mot de passe à chaque connexion.", requiredIntro: "Ce compte accède aux écrans d'administration de Meet Aaron : la double authentification y est obligatoire.", enable: 'Activer', scan: "1. Scanne ce QR code avec ton application d'authentification (Google Authenticator, 1Password, Authy…).", manual: 'Ou saisis cette clé à la main :', enterCode: "2. Saisis le code à six chiffres affiché par l'application :", confirm: 'Confirmer', cancel: 'Annuler', disable: 'Désactiver', disableAsk: 'Pour désactiver, saisis un code actuel :', codePlaceholder: '123456', enabledMsg: 'Double authentification activée. Le code te sera demandé à la prochaine connexion.', disabledMsg: 'Double authentification désactivée.', badCode: 'Code incorrect ou expiré. Réessaie avec le code affiché maintenant.', error: "Impossible pour le moment. Réessaie dans un instant.", since: 'Activée le {date}' },
  en: { title: 'Two-factor authentication', requiredBadge: 'Required for this account', on: 'Enabled', off: 'Disabled', intro: 'A six-digit code from an authenticator app on your phone is required on top of your password at every sign-in.', requiredIntro: 'This account reaches the Meet Aaron administration screens: two-factor authentication is mandatory here.', enable: 'Enable', scan: '1. Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy…).', manual: 'Or type this key manually:', enterCode: '2. Enter the six-digit code shown by the app:', confirm: 'Confirm', cancel: 'Cancel', disable: 'Disable', disableAsk: 'To disable, enter a current code:', codePlaceholder: '123456', enabledMsg: 'Two-factor authentication enabled. The code will be asked at your next sign-in.', disabledMsg: 'Two-factor authentication disabled.', badCode: 'Wrong or expired code. Try again with the code shown now.', error: 'Not possible right now. Try again in a moment.', since: 'Enabled on {date}' },
  de: { title: 'Zwei-Faktor-Authentifizierung', requiredBadge: 'Für dieses Konto Pflicht', on: 'Aktiviert', off: 'Deaktiviert', intro: 'Bei jeder Anmeldung wird zusätzlich zum Passwort ein sechsstelliger Code aus einer Authenticator-App abgefragt.', requiredIntro: 'Dieses Konto erreicht die Verwaltungsbildschirme von Meet Aaron: Zwei-Faktor-Authentifizierung ist hier Pflicht.', enable: 'Aktivieren', scan: '1. Scannen Sie diesen QR-Code mit Ihrer Authenticator-App (Google Authenticator, 1Password, Authy…).', manual: 'Oder geben Sie diesen Schlüssel manuell ein:', enterCode: '2. Geben Sie den sechsstelligen Code der App ein:', confirm: 'Bestätigen', cancel: 'Abbrechen', disable: 'Deaktivieren', disableAsk: 'Zum Deaktivieren einen aktuellen Code eingeben:', codePlaceholder: '123456', enabledMsg: 'Zwei-Faktor-Authentifizierung aktiviert. Der Code wird bei der nächsten Anmeldung abgefragt.', disabledMsg: 'Zwei-Faktor-Authentifizierung deaktiviert.', badCode: 'Falscher oder abgelaufener Code. Versuchen Sie es mit dem aktuell angezeigten Code.', error: 'Derzeit nicht möglich. Bitte gleich noch einmal versuchen.', since: 'Aktiviert am {date}' },
  it: { title: 'Autenticazione a due fattori', requiredBadge: 'Obbligatoria per questo account', on: 'Attiva', off: 'Disattivata', intro: 'A ogni accesso viene richiesto, oltre alla password, un codice a sei cifre generato da un\'app di autenticazione sul telefono.', requiredIntro: 'Questo account accede alle schermate di amministrazione di Meet Aaron: qui l\'autenticazione a due fattori è obbligatoria.', enable: 'Attiva', scan: '1. Scansiona questo QR code con la tua app di autenticazione (Google Authenticator, 1Password, Authy…).', manual: 'Oppure inserisci questa chiave a mano:', enterCode: '2. Inserisci il codice a sei cifre mostrato dall\'app:', confirm: 'Conferma', cancel: 'Annulla', disable: 'Disattiva', disableAsk: 'Per disattivare, inserisci un codice attuale:', codePlaceholder: '123456', enabledMsg: 'Autenticazione a due fattori attiva. Il codice sarà richiesto al prossimo accesso.', disabledMsg: 'Autenticazione a due fattori disattivata.', badCode: 'Codice errato o scaduto. Riprova con il codice mostrato adesso.', error: 'Impossibile al momento. Riprova tra poco.', since: 'Attiva dal {date}' },
  es: { title: 'Autenticación en dos pasos', requiredBadge: 'Obligatoria para esta cuenta', on: 'Activada', off: 'Desactivada', intro: 'En cada inicio de sesión se pide, además de la contraseña, un código de seis dígitos generado por una app de autenticación en tu teléfono.', requiredIntro: 'Esta cuenta accede a las pantallas de administración de Meet Aaron: aquí la autenticación en dos pasos es obligatoria.', enable: 'Activar', scan: '1. Escanea este código QR con tu app de autenticación (Google Authenticator, 1Password, Authy…).', manual: 'O escribe esta clave a mano:', enterCode: '2. Introduce el código de seis dígitos que muestra la app:', confirm: 'Confirmar', cancel: 'Cancelar', disable: 'Desactivar', disableAsk: 'Para desactivar, introduce un código actual:', codePlaceholder: '123456', enabledMsg: 'Autenticación en dos pasos activada. Se pedirá el código en el próximo inicio de sesión.', disabledMsg: 'Autenticación en dos pasos desactivada.', badCode: 'Código incorrecto o caducado. Vuelve a intentarlo con el código que se muestra ahora.', error: 'No es posible ahora mismo. Inténtalo de nuevo en un momento.', since: 'Activada el {date}' },
  pt: { title: 'Autenticação em dois passos', requiredBadge: 'Obrigatória para esta conta', on: 'Ativada', off: 'Desativada', intro: 'Em cada início de sessão é pedido, além da palavra-passe, um código de seis dígitos gerado por uma app de autenticação no teu telemóvel.', requiredIntro: 'Esta conta acede aos ecrãs de administração do Meet Aaron: aqui a autenticação em dois passos é obrigatória.', enable: 'Ativar', scan: '1. Lê este código QR com a tua app de autenticação (Google Authenticator, 1Password, Authy…).', manual: 'Ou escreve esta chave à mão:', enterCode: '2. Introduz o código de seis dígitos mostrado pela app:', confirm: 'Confirmar', cancel: 'Cancelar', disable: 'Desativar', disableAsk: 'Para desativar, introduz um código atual:', codePlaceholder: '123456', enabledMsg: 'Autenticação em dois passos ativada. O código será pedido no próximo início de sessão.', disabledMsg: 'Autenticação em dois passos desativada.', badCode: 'Código errado ou expirado. Tenta de novo com o código mostrado agora.', error: 'Não é possível neste momento. Tenta novamente daqui a pouco.', since: 'Ativada em {date}' },
  nl: { title: 'Tweestapsverificatie', requiredBadge: 'Verplicht voor dit account', on: 'Ingeschakeld', off: 'Uitgeschakeld', intro: 'Bij elke aanmelding wordt naast je wachtwoord een zescijferige code uit een authenticator-app op je telefoon gevraagd.', requiredIntro: 'Dit account heeft toegang tot de beheerschermen van Meet Aaron: tweestapsverificatie is hier verplicht.', enable: 'Inschakelen', scan: '1. Scan deze QR-code met je authenticator-app (Google Authenticator, 1Password, Authy…).', manual: 'Of typ deze sleutel handmatig in:', enterCode: '2. Voer de zescijferige code in die de app toont:', confirm: 'Bevestigen', cancel: 'Annuleren', disable: 'Uitschakelen', disableAsk: 'Voer om uit te schakelen een huidige code in:', codePlaceholder: '123456', enabledMsg: 'Tweestapsverificatie ingeschakeld. De code wordt bij je volgende aanmelding gevraagd.', disabledMsg: 'Tweestapsverificatie uitgeschakeld.', badCode: 'Verkeerde of verlopen code. Probeer het opnieuw met de code die nu wordt getoond.', error: 'Nu niet mogelijk. Probeer het zo opnieuw.', since: 'Ingeschakeld op {date}' },
};
const tx = (locale, key) => (TEXT[locale] || TEXT.fr)[key] || TEXT.fr[key];

export default function MfaSettings({ locale = 'fr', required = false }) {
  const [factor, setFactor] = useState(null); // facteur TOTP vérifié, ou null
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(null); // { id, qr, secret }
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await supabaseBrowser.auth.mfa.listFactors();
      const verified = (data?.totp || []).find((f) => f.status === 'verified') || null;
      setFactor(verified);
      // Facteurs restés « unverified » (enrôlement abandonné) : on les
      // nettoie pour que l'enrôlement suivant parte propre.
      for (const f of data?.totp || []) {
        if (f.status !== 'verified') {
          try { await supabaseBrowser.auth.mfa.unenroll({ factorId: f.id }); } catch (err) {}
        }
      }
    } catch (err) {
      setFactor(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function startEnroll() {
    setError(null); setMessage(null); setBusy(true);
    try {
      const { data, error: enrollError } = await supabaseBrowser.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Meet Aaron' });
      if (enrollError || !data) throw enrollError || new Error('enroll');
      setEnrolling({ id: data.id, qr: data.totp?.qr_code, secret: data.totp?.secret });
      setCode('');
    } catch (err) {
      setError(tx(locale, 'error'));
    }
    setBusy(false);
  }

  async function confirmEnroll() {
    if (!enrolling || !/^\d{6}$/.test(code.trim())) { setError(tx(locale, 'badCode')); return; }
    setError(null); setBusy(true);
    try {
      const { data: challenge, error: chError } = await supabaseBrowser.auth.mfa.challenge({ factorId: enrolling.id });
      if (chError || !challenge) throw chError || new Error('challenge');
      const { error: vError } = await supabaseBrowser.auth.mfa.verify({ factorId: enrolling.id, challengeId: challenge.id, code: code.trim() });
      if (vError) { setError(tx(locale, 'badCode')); setBusy(false); return; }
      setEnrolling(null);
      setCode('');
      setMessage(tx(locale, 'enabledMsg'));
      // La session est maintenant aal2 : on la rafraîchit pour que les
      // appels suivants portent le bon niveau.
      try { await supabaseBrowser.auth.refreshSession(); } catch (err) {}
      await load();
    } catch (err) {
      setError(tx(locale, 'error'));
    }
    setBusy(false);
  }

  async function cancelEnroll() {
    if (enrolling) {
      try { await supabaseBrowser.auth.mfa.unenroll({ factorId: enrolling.id }); } catch (err) {}
    }
    setEnrolling(null); setCode(''); setError(null);
  }

  async function confirmDisable() {
    if (!factor || !/^\d{6}$/.test(code.trim())) { setError(tx(locale, 'badCode')); return; }
    setError(null); setBusy(true);
    try {
      // Retirer un facteur exige une session aal2 : on vérifie le code
      // d'abord, puis on désenrôle.
      const { data: challenge, error: chError } = await supabaseBrowser.auth.mfa.challenge({ factorId: factor.id });
      if (chError || !challenge) throw chError || new Error('challenge');
      const { error: vError } = await supabaseBrowser.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: code.trim() });
      if (vError) { setError(tx(locale, 'badCode')); setBusy(false); return; }
      const { error: unError } = await supabaseBrowser.auth.mfa.unenroll({ factorId: factor.id });
      if (unError) throw unError;
      setDisabling(false); setCode('');
      setMessage(tx(locale, 'disabledMsg'));
      try { await supabaseBrowser.auth.refreshSession(); } catch (err) {}
      await load();
    } catch (err) {
      setError(tx(locale, 'error'));
    }
    setBusy(false);
  }

  const enabled = !!factor;
  const sinceDate = factor?.updated_at || factor?.created_at;

  return (
    <div className="mfa">
      <div className="mfa-head">
        <Ic name="lock" size={16} />
        <strong>{tx(locale, 'title')}</strong>
        <span className={`mfa-state ${enabled ? 'on' : 'off'}`}>{loading ? '…' : enabled ? tx(locale, 'on') : tx(locale, 'off')}</span>
        {required && <span className="mfa-required">{tx(locale, 'requiredBadge')}</span>}
      </div>
      <p className="mfa-intro">{required ? tx(locale, 'requiredIntro') : tx(locale, 'intro')}</p>
      {enabled && sinceDate && !disabling && (
        <p className="mfa-since">{tx(locale, 'since').replace('{date}', new Date(sinceDate).toLocaleDateString(locale))}</p>
      )}

      {!loading && !enabled && !enrolling && (
        <button type="button" className="btn-primary" onClick={startEnroll} disabled={busy}>{tx(locale, 'enable')}</button>
      )}

      {enrolling && (
        <div className="mfa-enroll">
          <p className="mfa-step">{tx(locale, 'scan')}</p>
          {enrolling.qr && <img className="mfa-qr" src={enrolling.qr} alt="QR code" width={180} height={180} />}
          {enrolling.secret && (
            <p className="mfa-secret"><span>{tx(locale, 'manual')}</span> <code>{enrolling.secret}</code></p>
          )}
          <p className="mfa-step">{tx(locale, 'enterCode')}</p>
          <input
            className="mfa-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder={tx(locale, 'codePlaceholder')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmEnroll(); }}
          />
          <div className="mfa-actions">
            <button type="button" className="btn-primary" onClick={confirmEnroll} disabled={busy || code.length !== 6}>{tx(locale, 'confirm')}</button>
            <button type="button" className="btn-ghost" onClick={cancelEnroll} disabled={busy}>{tx(locale, 'cancel')}</button>
          </div>
        </div>
      )}

      {enabled && !disabling && !required && (
        <button type="button" className="btn-ghost" onClick={() => { setDisabling(true); setCode(''); setError(null); setMessage(null); }}>{tx(locale, 'disable')}</button>
      )}
      {enabled && disabling && (
        <div className="mfa-enroll">
          <p className="mfa-step">{tx(locale, 'disableAsk')}</p>
          <input
            className="mfa-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder={tx(locale, 'codePlaceholder')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="mfa-actions">
            <button type="button" className="btn-danger" onClick={confirmDisable} disabled={busy || code.length !== 6}>{tx(locale, 'disable')}</button>
            <button type="button" className="btn-ghost" onClick={() => { setDisabling(false); setCode(''); setError(null); }} disabled={busy}>{tx(locale, 'cancel')}</button>
          </div>
        </div>
      )}

      {error && <p className="mfa-error">{error}</p>}
      {message && <p className="mfa-ok">{message}</p>}

      <style jsx>{`
        .mfa { margin-top: 1.4rem; padding-top: 1.1rem; border-top: 1px solid var(--border); }
        .mfa-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.92rem; }
        .mfa-head :global(svg) { color: var(--accent); }
        .mfa-state { font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
        .mfa-state.on { color: var(--state-good-text, #1f9d55); border-color: currentColor; }
        .mfa-required { font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px; background: var(--state-warn-bg, rgba(245,166,35,0.15)); color: var(--state-warn-text, #b7791f); }
        .mfa-intro { font-size: 0.84rem; color: var(--muted); margin: 0.5rem 0 0.8rem; }
        .mfa-since { font-size: 0.78rem; color: var(--muted); margin: -0.4rem 0 0.8rem; }
        .mfa-enroll { margin-top: 0.6rem; padding: 0.9rem; border-radius: var(--radius-md); background: var(--bg); }
        .mfa-step { font-size: 0.84rem; margin: 0 0 0.6rem; }
        .mfa-qr { display: block; width: 180px; height: 180px; border-radius: 8px; background: #fff; padding: 6px; margin-bottom: 0.6rem; }
        .mfa-secret { font-size: 0.76rem; color: var(--muted); margin: 0 0 0.8rem; overflow-wrap: anywhere; }
        .mfa-secret code { font-size: 0.78rem; color: var(--text); }
        .mfa-code { width: 9ch; font-size: 1.3rem; letter-spacing: 0.3em; text-align: center; padding: 0.45rem 0.6rem; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--card, var(--bg)); color: var(--text); }
        .mfa-actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; flex-wrap: wrap; }
        .btn-primary { background: var(--accent); color: #fff; border: 0; border-radius: var(--radius-sm, 8px); padding: 0.55rem 1rem; font-size: 0.86rem; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.5; cursor: default; }
        .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); padding: 0.55rem 1rem; font-size: 0.86rem; cursor: pointer; margin-top: 0.4rem; }
        .btn-danger { background: transparent; color: var(--state-bad-text, #d03c3c); border: 1px solid currentColor; border-radius: var(--radius-sm, 8px); padding: 0.55rem 1rem; font-size: 0.86rem; cursor: pointer; }
        .btn-danger:disabled { opacity: 0.5; }
        .mfa-error { color: var(--state-bad-text, #d03c3c); font-size: 0.82rem; margin: 0.6rem 0 0; }
        .mfa-ok { color: var(--state-good-text, #1f9d55); font-size: 0.82rem; margin: 0.6rem 0 0; }
      `}</style>
    </div>
  );
}
