# Meet Aaron — Secrets management policy

Version 1.1 — 23 October 2026 — owner: Alexandre Fèvre (founder, sole operator)
Public summary: https://meetaaron.app/security (section 5)

## 1. Where secrets live

- Every server-side secret is a Vercel project environment variable of type **Secret**.
  A Secret value cannot be viewed or retrieved by any team member once saved
  (Vercel, "Environment variables now use Config and Secret types", 24 Aug 2026);
  it is only injected into the serverless functions at runtime. The project has
  **0 Config-type variables**: every variable is a Secret.
- Nothing secret is in the repository or its history, in the database, on a
  workstation, or in a messaging tool.
- User OAuth tokens and IMAP/SMTP passwords are not environment variables: they
  are stored in the database encrypted with AES-256-GCM (lib/encryption.ts), under
  TOKEN_ENCRYPTION_KEY.

## 2. Who can access what (role rules)

| Role | Holder | Can add / replace a secret | Can read a secret value |
|---|---|---|---|
| Vercel team Owner | founder only (1 member, 2FA enabled) | yes | no (Secret type) |
| Supabase project Owner | founder only | service-role key rotation | not exposed by the application |
| Any other person | none exists | no | no |
| Browser / client code | — | no | never receives a server secret (only NEXT_PUBLIC_* public values) |

## 3. Secret-to-service map (each secret is used by one service, in the listed modules only)

| Secret | Service | Used only by | Rotation |
|---|---|---|---|
| SUPABASE_SERVICE_ROLE_KEY | Supabase (database admin) | lib/supabase-admin.ts | on suspicion; on staff change |
| TOKEN_ENCRYPTION_KEY (+ _PREVIOUS during rotation) | AES-256-GCM at rest | lib/encryption.ts; HMAC sub-key in lib/marketing-tracking.ts | yearly, or immediately on suspicion (dual-key rotation, no downtime) |
| CRON_SECRET | Scheduled tasks auth | app/api/cron/* (Authorization header check) | yearly / on suspicion |
| ANTHROPIC_API_KEY | Anthropic API | lib/anthropic-client.ts, lib/aaron-batch.ts | yearly / on suspicion |
| OPENAI_API_KEY | OpenAI API | lib/model-router.ts | yearly / on suspicion |
| STRIPE_SECRET_KEY | Stripe API | lib/stripe.ts | yearly / on suspicion |
| STRIPE_WEBHOOK_SECRET | Stripe webhook signature | app/api/webhooks/stripe | on endpoint change / suspicion |
| GOOGLE_CLIENT_SECRET | Google OAuth | app/api/auth/google/callback, lib/google.ts | yearly / on suspicion |
| MICROSOFT_CLIENT_SECRET | Microsoft Entra OAuth | app/api/auth/microsoft/callback, lib/microsoft.ts | before Entra expiry (max 24 months) |
| HUBSPOT / SALESFORCE / PIPEDRIVE / JOBBER_CLIENT_SECRET | CRM OAuth | app/api/auth/<crm>, lib/crm-sync.ts | yearly / on suspicion |
| YOUTRUST_API_KEY / YOUTRUST_WEBHOOK_SECRET | e-signature | lib/youtrust.ts / app/api/webhooks/youtrust | yearly / on suspicion |
| VAPID_PRIVATE_KEY | Web Push signing | lib/push.ts | on suspicion (re-subscription needed) |
| DAILY_API_KEY | Video rooms | lib/video-room.ts | yearly / on suspicion |
| GOOGLE_PLACES_API_KEY, COMPANIES_HOUSE_API_KEY, ABN_LOOKUP_GUID | Company directories | lib/company-directory.ts, lib/sourcing.ts, lib/fresh-companies.ts | yearly / on suspicion |

## 4. Logging, monitoring and alerting

- **Retrieval by people:** not possible (Secret type). There is therefore no
  human "read" event to log; the only consumer of a value is the deployed code.
- **Changes:** adding, replacing or removing a variable requires the Owner
  account (2FA). A new value only takes effect on the next production
  deployment, which is recorded in the Vercel deployment history (author,
  commit, time); the variable list shows who last edited each variable and when.
- **Use by the application:** the code never logs a secret value (CASA 6.5.1).
  Failures of secret use are logged and visible in Vercel runtime logs:
  decryption failures (`[encryption] ...`, lib/encryption.ts), use of the previous
  key during rotation, Stripe/Youtrust signature rejections, cron calls with a
  wrong CRON_SECRET (HTTP 401).
- **Anomaly alerting on provider keys:** spend on the Anthropic key is computed
  daily and the founder is alerted by push + e-mail when the remaining balance
  covers less than 10 then 3 days (app/api/cron/api-balance-alert); a hard
  monthly cost ceiling per customer blocks runaway usage (lib/hard-ceiling-alert.ts).
  Each provider console (Stripe, Google Cloud, Microsoft Entra, Anthropic,
  OpenAI) keeps its own API-key usage log, consulted on any alert.

## 5. Incident response

On suspected exposure: replace the value in Vercel (new deployment), revoke the
old key at the provider, review provider usage logs for the exposure window,
and for TOKEN_ENCRYPTION_KEY run the dual-key rotation (new key encrypts, old key
kept as TOKEN_ENCRYPTION_KEY_PREVIOUS until every value is rewritten).
