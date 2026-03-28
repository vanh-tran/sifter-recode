# Gmail + Outlook OAuth Connection Design

**Date:** 2026-03-28
**Status:** Approved — proceeding to implementation

---

## Problem

The frontend (`MailboxesTab`, `OnboardingWizard`) already links to `/api/oauth/gmail/connect` and `/api/oauth/outlook/connect`, but these routes do not exist. Users cannot connect a mailbox, which blocks both onboarding and the document pipeline.

---

## Scope

- Gmail OAuth connect + callback
- Outlook OAuth connect + callback
- Shared utility for PKCE, session management, token encryption, DB writes
- Frontend error surfacing (toast) in `MailboxesTab` and `OnboardingWizard`

---

## Approach

**4 separate routes + shared utility (Approach A)**

| File | Purpose |
|---|---|
| `app/api/oauth/gmail/connect/route.ts` | Initiate Gmail OAuth |
| `app/api/gmail/connect/callback/route.ts` | Handle Gmail OAuth callback |
| `app/api/oauth/outlook/connect/route.ts` | Initiate Outlook OAuth |
| `app/api/outlook/connect/callback/route.ts` | Handle Outlook OAuth callback |
| `lib/server/oauth-connect.ts` | Shared: PKCE, session, token encryption, DB writes |

Routes handle only provider-specific OAuth URL construction and token exchange. All shared logic lives in the utility.

---

## Flow

### Connect (Gmail or Outlook)

1. Set short-lived cookie `oauth_return_to = 'onboarding' | 'settings'` (read from `?return_to=` query param)
2. Generate PKCE: `code_verifier` (random), `code_challenge` (SHA-256 of verifier, base64url)
3. Insert `oauth_sessions` row: `state`, `code_verifier`, `code_challenge`, `user_id`, `org_id`, `status = 'pending'`, `expires_at = now + 10min`
4. Redirect to Google / Microsoft consent screen with `state`, `code_challenge`, `scope`, `redirect_uri`

### Callback (Gmail or Outlook)

1. If provider returned `error` param → redirect to origin with `?error=access_denied` or `?error=oauth_error`
2. Look up `oauth_sessions` by `state` → if missing or `status != 'pending'` or expired → redirect to `/settings?error=invalid_session`
3. Exchange `code` for tokens using `code_verifier` from session
4. Fetch user email (Google: `/oauth2/v1/userinfo`; Microsoft: `https://graph.microsoft.com/v1.0/me`)
5. Encrypt both tokens: `encryptOAuthSecret(refresh_token)`, `encryptOAuthSecret(access_token)`
6. Upsert `email_connections` on `(org_id, provider, email)` → `status = 'active'`
7. Upsert `oauth_tokens` on `connection_id` → write encrypted tokens + `expires_at`
8. Mark `oauth_sessions.status = 'used'`
9. Read `oauth_return_to` cookie → redirect to `/onboarding` or `/settings` (fallback: `/settings`)

---

## Database Writes

### `oauth_sessions` (on connect)

```
state            — random UUID (sent as OAuth state param)
code_verifier    — PKCE verifier
code_challenge   — SHA-256(code_verifier), base64url
user_id, org_id  — from authenticated session
status           = 'pending'
expires_at       = now + 10 minutes
```

Schema already includes a 10-minute default on `expires_at`. No migration needed.

### `email_connections` (upserted on callback)

```
org_id, user_id, provider ('gmail' | 'outlook'), email
status           = 'active'
last_synced_at   = null  (worker fills on first sync)
history_id       = null  (Gmail fills on first sync)
```

Upsert key: `(org_id, provider, email)` — reconnecting an existing account reactivates it rather than creating a duplicate.

### `oauth_tokens` (upserted on callback)

```
connection_id            — FK to email_connections
refresh_token_encrypted  — encryptOAuthSecret(refresh_token)
access_token_encrypted   — encryptOAuthSecret(access_token)
expires_at               — plaintext timestamp (not sensitive)
```

Column names match the existing schema (`refresh_token_encrypted`, `access_token_encrypted`). No migration needed.

---

## `oauth_return_to` Cookie

- Set on the connect route with `Max-Age: 300` (5 min), `HttpOnly`, `SameSite=Lax`, `Path=/`
- Values: `'onboarding'` → redirect to `/onboarding`; `'settings'` → redirect to `/settings`
- On callback: if cookie is missing, invalid, or anything other than `'onboarding'` → fall back to `/settings`

---

## Environment Variables

| Variable | Used by |
|---|---|
| `GOOGLE_GMAIL_CLIENT_ID` | Gmail connect + callback |
| `GOOGLE_GMAIL_CLIENT_SECRET` | Gmail callback (token exchange) |
| `GOOGLE_GMAIL_REDIRECT_URI` | Gmail connect (sent to Google) + callback (verification) |
| `MICROSOFT_OUTLOOK_CLIENT_ID` | Outlook connect + callback |
| `MICROSOFT_OUTLOOK_CLIENT_SECRET` | Outlook callback |
| `MICROSOFT_OUTLOOK_REDIRECT_URI` | Outlook connect + callback |

All already present in `.env.local`.

---

## Gmail Scopes

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/userinfo.email
```

## Outlook Scopes

```
https://graph.microsoft.com/Mail.Read
https://graph.microsoft.com/User.Read
offline_access
```

---

## Error Handling

### Callback error cases

| Scenario | Redirect destination | `?error=` value |
|---|---|---|
| Provider returned `error=access_denied` | origin (cookie) or `/settings` | `access_denied` |
| Provider returned any other `error` | origin | `oauth_error` |
| `state` not found in `oauth_sessions` | `/settings` | `invalid_session` |
| Session expired or already `used` | `/settings` | `invalid_session` |
| Token exchange HTTP failure | origin | `token_exchange_failed` |
| Userinfo fetch failure | origin | `userinfo_failed` |
| DB write failure | origin | `connection_failed` |

### Frontend toast messages

Both `MailboxesTab` and `OnboardingWizard` read `searchParams.get('error')` on mount, show a toast, then strip the param from the URL.

| `?error=` | Toast message |
|---|---|
| `access_denied` | "Gmail/Outlook access was cancelled. Please try again." |
| `oauth_error` | "Something went wrong with Google/Microsoft. Please try again." |
| `invalid_session` | "OAuth session expired. Please try connecting again." |
| `token_exchange_failed` | "Couldn't complete the connection. Please try again." |
| `userinfo_failed` | "Couldn't fetch your email address. Please try again." |
| `connection_failed` | "Couldn't save the connection. Please try again." |

---

## What Is Not In Scope

- Outlook: no changes to the Gmail sync worker (already handles email_connections)
- Token refresh logic (worker already calls `decryptOAuthSecret` and refreshes as needed)
- Disconnect (already implemented via `DELETE /api/mailboxes/[id]`)
