# Security Policy

## Secrets & credentials

- **Never commit secrets.** `.env`, `*.env`, keys and credentials are gitignored;
  only `.env.example` (empty placeholders) is tracked. The repository history has
  been scanned and contains **no** secrets or credentials.
- Real values live only in a local, untracked `.env`. Generate fresh secrets:
  - `SECRET_KEY`: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
  - `FERNET_KEY`: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- **Automated scanning:** [gitleaks](.github/workflows/secret-scan.yml) scans the
  full history on every push/PR and daily; [CodeQL](.github/workflows/codeql.yml)
  runs security-extended static analysis for Python and TypeScript.

### If a key is exposed
1. **Rotate immediately** at the AI provider dashboard (revoke + create new;
   regenerate `SECRET_KEY`/`FERNET_KEY`). Rotating `SECRET_KEY` invalidates all
   issued JWTs; rotating `FERNET_KEY` requires re-encrypting stored datasource
   connection strings.
2. If the secret reached a commit, purge it from history (`git filter-repo` /
   BFG) and force-push, then rotate anyway — assume it is compromised.

### Recommended GitHub repo settings
Enable under **Settings → Code security**: Secret scanning, Push protection,
Dependabot alerts + security updates, and CodeQL code scanning.

## Hardening implemented in the app
- SSRF guard on datasource connection strings (blocks private/loopback/link-local/
  reserved hosts, incl. the cloud metadata endpoint). Also inspects the IPv4 target
  embedded in IPv6 transition addresses (IPv4-mapped, 6to4, Teredo) so a host that
  resolves to e.g. `2002:a9fe:a9fe::` (6to4 → 169.254.169.254) can't tunnel past the
  filter — `app/core/net_guard.py`.
- SELECT-only SQL guard: single statement, no `INTO`, no dangerous functions, no
  `PRAGMA`/`ATTACH`/`DETACH`/`VACUUM` — `app/ai/sql_guard.py`. The table allowlist
  (`assert_tables_in_schema`) is enforced on every execution path, including the
  demo natural-language pipeline.
- JWT signed HS256 with a fixed algorithm allowlist (no `alg=none` confusion).
- Per-IP rate limiting on `/auth/login`, `/auth/register`, public share routes and
  the collaboration WebSocket — `app/core/rate_limit.py`. Client-IP resolution
  honors `TRUSTED_PROXY_HOPS` so per-IP throttles survive behind a reverse proxy
  instead of collapsing every client into the proxy's bucket; `X-Forwarded-For` is
  trusted only up to the configured proxy count (default 0 = never trusted).
- Tier upgrades restricted to purchasable plans and gated behind a payment provider
  outside demo (no free self-escalation to unlimited) — `app/api/v1/billing.py`.
- Security headers on every response; `/metrics` restricted to loopback or a scrape
  token; interactive API docs disabled outside demo — `app/main.py`.
- Datasource connection strings encrypted at rest (Fernet); strong-secret startup
  checks in production.
- AutoML model blobs (`ml_models.model_blob`) are pickles of estimators trained
  by the server itself; they are written only by `automl_service.train`, read back
  only from our own database, never accepted from a client, and excluded from every
  API schema/response. As defense in depth each blob is HMAC-signed with a
  SECRET_KEY-derived key on write and verified before every `pickle.loads`, so a
  DB-write compromise can't smuggle a malicious pickle into code execution.
  Rotating `SECRET_KEY` invalidates existing blobs (retrain) — the same posture as
  `FERNET_KEY` — `app/services/automl_service.py`.
- The login form remembers only the email address for one-click sign-in; the
  password is never persisted, and any legacy `{email,password}` record is purged
  to email-only on read — `frontend/src/lib/loginHint.ts`.
- AI-generated Mermaid diagrams pass three sanitization layers before injection:
  a server-side source sanitizer, mermaid's `securityLevel: 'strict'`, and a
  client-side SVG sanitizer that strips `<script>`, `on*` handlers and
  `javascript:` URLs — `frontend/src/lib/svgSanitize.ts`.
- Foreign-key enforcement is switched on for SQLite connections, so deletes
  actually propagate on the demo/dev database as they already did on Postgres.
  SQLite ignores foreign keys unless `PRAGMA foreign_keys=ON` is set per
  connection; without it every declared `ON DELETE` rule was inert, and removing
  a datasource left decisions, saved queries, BA artifacts, ML models and query
  logs still pointing at it while CASCADE children outlived their parent —
  `app/db/session.py`.

## Known tradeoffs / planned follow-ups
- **Auth tokens in `localStorage`.** The SPA stores its access and refresh JWTs in
  `localStorage` rather than `httpOnly` cookies — the standard tradeoff for a
  token-bearer SPA. This keeps them reachable to any successful XSS. The codebase
  minimizes XSS surface (React escaping everywhere, the Mermaid layers above, and
  no persisted passwords), but moving the refresh token to an `httpOnly`, `SameSite`
  cookie with CSRF protection is the intended hardening step. It touches auth
  end-to-end (login/refresh/logout/CORS/embed) and is deferred to a dedicated,
  fully-tested change rather than bundled here.
- **Rate-limit backing store.** Limits are per-process in-memory — correct for the
  single-worker demo. A multi-worker production deploy should back them with Redis
  (shared `app.state.cache`) so buckets are shared across workers and survive
  restarts. `TRUSTED_PROXY_HOPS` should be set to the real proxy count there.

## Reporting a vulnerability
Open a private security advisory on GitHub or email the maintainer. Please do not
file public issues for undisclosed vulnerabilities.
