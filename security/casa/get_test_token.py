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
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "casa-scan"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def find_public_supabase_config():
    url = key = None
    html = get(SITE + "/login")
    scripts = sorted(set(re.findall(r'src="(/_next/static/[^"]+\.js)"', html)))
    for s in scripts:
        js = get(SITE + s)
        if not url:
            m = re.search(r"https://[a-z0-9]{10,}\.supabase\.co", js)
            if m:
                url = m.group(0)
        if not key:
            m = re.search(r"sb_publishable_[A-Za-z0-9_-]{20,}", js)
            if m:
                key = m.group(0)
        if not key:
            for m in re.finditer(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", js):
                if '"anon"' in base64.urlsafe_b64decode(m.group(0).split(".")[1] + "==").decode("utf-8", "ignore"):
                    key = m.group(0)
                    break
        if url and key:
            return url, key
    sys.exit("Configuration Supabase publique introuvable dans le JavaScript du site")


def main():
    email = os.environ.get("CASA_TEST_EMAIL")
    password = os.environ.get("CASA_TEST_PASSWORD")
    if not email or not password:
        sys.exit("Secrets CASA_TEST_EMAIL / CASA_TEST_PASSWORD manquants")
    sb_url, anon = find_public_supabase_config()
    tok = post(
        sb_url + "/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": anon, "Content-Type": "application/json"},
    )
    access = tok["access_token"]
    print("::add-mask::" + access)
    link = post(SITE + "/api/auth/link", {}, {"Authorization": "Bearer " + access, "Content-Type": "application/json"})
    user_id = (link.get("user") or {}).get("id")
    if not user_id:
        sys.exit("Profil Meet Aaron du compte de test introuvable")
    with open(os.environ["GITHUB_ENV"], "a") as f:
        f.write("ZAP_TOKEN=" + access + "\n")
        f.write("USER_ID=" + user_id + "\n")
    print("Compte de test authentifié, user_id " + user_id)


if __name__ == "__main__":
    main()
