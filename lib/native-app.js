// lib/native-app.js
// Détection de l'application iOS (coque Capacitor, dossier ios-app/) depuis
// le site. Capacitor injecte `window.Capacitor` dans la page quand elle est
// chargée dans la coque — y compris quand la page vient du serveur
// (server.url dans capacitor.config.json), ce qui est notre cas : le site
// reste le même pour tout le monde, seules quelques décisions changent
// (notifications par APNs plutôt que Web Push, pas d'invitation « ajouter à
// l'écran d'accueil », ouverture des notifications dans l'app).
//
// La coque Android (dossier android/, Trusted Web Activity) n'injecte rien :
// c'est le vrai Chrome, le site s'y comporte comme dans un navigateur.

export function getCapacitor() {
  if (typeof window === 'undefined') return null;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function') return null;
  try {
    return cap.isNativePlatform() ? cap : null;
  } catch {
    return null;
  }
}

export function isNativeApp() {
  return !!getCapacitor();
}

// Application Android du Play Store (12/11/2026). La coque TWA n'injecte
// rien dans la page, mais Chrome pose `document.referrer` =
// android-app://app.meetaaron.mobile/ sur la première page ouverte par
// l'app. On le mémorise pour la session (onglet de la TWA) : les pages
// suivantes ont un referrer https ordinaire.
const TWA_FLAG = 'aaron_store_android';
export function isAndroidStoreApp() {
  if (typeof window === 'undefined') return false;
  try {
    if ((document.referrer || '').startsWith('android-app://app.meetaaron.mobile')) {
      window.sessionStorage.setItem(TWA_FLAG, '1');
      return true;
    }
    return window.sessionStorage.getItem(TWA_FLAG) === '1';
  } catch {
    return false;
  }
}

// Application installée depuis un store (App Store OU Play Store) : aucun
// achat ni inscription payante dans l'app. Apple (règle 3.1.1) comme Google
// (règlement Paiements : un service numérique vendu dans l'app passe par
// leur facturation) l'exigent ; l'abonnement et les boosts se prennent sur
// le site, l'app se contente de le dire.
export function isStoreApp() {
  return isNativeApp() || isAndroidStoreApp();
}

// 'ios' | 'android' | null
export function nativePlatform() {
  const cap = getCapacitor();
  if (!cap) return null;
  try {
    return typeof cap.getPlatform === 'function' ? cap.getPlatform() : null;
  } catch {
    return null;
  }
}

// Le plugin natif de notifications, s'il est embarqué dans la coque.
export function nativePushPlugin() {
  const cap = getCapacitor();
  const plugin = cap && cap.Plugins && cap.Plugins.PushNotifications;
  return plugin && typeof plugin.register === 'function' ? plugin : null;
}

// Demande le jeton APNs de l'appareil : `register()` répond par un événement
// `registration` (ou `registrationError`), jamais par une valeur de retour.
// On attend au plus `timeoutMs`.
export function requestNativePushToken(plugin, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handles = [];
    const cleanup = () => {
      handles.forEach((h) => {
        Promise.resolve(h)
          .then((x) => x && typeof x.remove === 'function' && x.remove())
          .catch(() => {});
      });
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs);
    handles.push(plugin.addListener('registration', (token) => finish(resolve, token && token.value)));
    handles.push(plugin.addListener('registrationError', (err) => finish(reject, new Error((err && err.error) || 'registrationError'))));
    Promise.resolve(plugin.register()).catch((err) => finish(reject, err));
  });
}

// Ouvre une URL « hors de la page » : dans l'application iOS, dans Safari
// (SFSafariViewController via le plugin Browser — Google et Microsoft
// refusent leurs écrans de consentement dans une WebView) ; ailleurs, simple
// navigation. Les URL relatives sont résolues sur le site courant.
export function openExternal(url) {
  if (typeof window === 'undefined') return;
  const absolute = new URL(url, window.location.origin).toString();
  const cap = getCapacitor();
  const browser = cap && cap.Plugins && cap.Plugins.Browser;
  if (browser && typeof browser.open === 'function') {
    Promise.resolve(browser.open({ url: absolute, presentationStyle: 'popover' })).catch(() => {
      window.location.href = absolute;
    });
    return;
  }
  window.location.href = absolute;
}
