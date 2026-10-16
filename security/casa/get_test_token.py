#!/usr/bin/env python3
"""Obtient un jeton de session pour le compte de TEST du scan CASA.

Utilisé uniquement par .github/workflows/casa-zap.yml. Les identifiants du
compte de test viennent des secrets GitHub CASA_TEST_EMAIL et
CASA_TEST_PASSWORD (saisis par Alex dans GitHub, jamais écrits dans le code).

L'URL Supabase et la clé publique « anon » sont lues dans le JavaScript
public de meetaaron.app (c'est une clé publique : elle est livrée à chaque
navigateur). Aucune clé n'est donc stockée ici.

Sortie : écrit ZAP_TOKEN et USER_ID dans $GITHUB_ENV (jeton masqué dans les
journaux par ::add-mask::).
"""
import base64
import json
import os
import re
import sys
import urllib.request

SITE = "https://meetaaron.app"


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) casa-scan"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def find_public_supabase_config():
    """Cherche l'URL Supabase et la clé publique dans les chunks JS de /login.

    Les balises <script> de Next.js portent un paramètre ?dpl=… (Vercel) :
    on l'accepte. On privilégie le chunk qui contient À LA FOIS l'URL du
    projet et une clé, c'est-à-dire la configuration de l'app, et non une
    chaîne d'exemple de la bibliothèque Supabase.
    """
    html = get(SITE + "/login")
    scripts = []
    for m in re.finditer(r'src="(/_next/static/[^"?]+\.js(?:\?[^"]*)?)"', html):
        if m.group(1) not in scripts:
            scripts.append(m.group(1))
    fallback_url = fallback_key = None
    for s in scripts:
        js = get(SITE + s.replace("&amp;", "&"))
        m = re.search(r"https://[a-z0-9]{15,}\.supabase\.co", js)
        url = m.group(0) if m else None
        key = None
        m = re.search(r"sb_publishable_[A-Za-z0-9_-]{20,}", js)
        if m:
            key = m.group(0)
        if not key:
            for m in re.finditer(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", js):
                payload = base64.urlsafe_b64decode(m.group(0).split(".")[1] + "==").decode("utf-8", "ignore")
                if '"anon"' in payload:
                    key = m.group(0)
                    break
        if url and key:
            return url, key
        fallback_url = fallback_url or url
        fallback_key = fallback_key or key
    if fallback_url and fallback_key:
        return fallback_url, fallback_key
    sys.exit("Configuration Supabase publique introuvable dans le JavaScript du site (%d scripts lus)" % len(scripts))


def main():
    email = os.environ.get("CASA_TEST_EMAIL")
    password = os.environ.get("CASA_TEST_PASSWORD")
    if not email or not password:
        sys.exit("Secrets CASA_TEST_EMAIL / CASA_TEST_PASSWORD manquants")
    # Renouvellements : l'URL et la clé publique gardées du premier appel
    # évitent de redemander le JavaScript à meetaaron.app (dont le pare-feu
    # peut répondre 403 juste après un scan) ; seul Supabase est contacté.
    sb_url, anon = os.environ.get("SB_URL"), os.environ.get("SB_ANON")
    if not (sb_url and anon):
        sb_url, anon = find_public_supabase_config()
    tok = post(
        sb_url + "/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": anon, "Content-Type": "application/json"},
    )
    access = tok["access_token"]
    print("::add-mask::" + access)
    user_id = os.environ.get("USER_ID")
    if not user_id:
        link = post(SITE + "/api/auth/link", {}, {"Authorization": "Bearer " + access, "Content-Type": "application/json"})
        user_id = (link.get("user") or {}).get("id")
    if not user_id:
        sys.exit("Profil Meet Aaron du compte de test introuvable")
    with open(os.environ["GITHUB_ENV"], "a") as f:
        f.write("ZAP_TOKEN=" + access + "\n")
        f.write("USER_ID=" + user_id + "\n")
        f.write("SB_URL=" + sb_url + "\n")
        f.write("SB_ANON=" + anon + "\n")
    print("Compte de test authentifié, user_id " + user_id + ", jeton valable " + str(tok.get("expires_in", "?")) + " s")


if __name__ == "__main__":
    main()
