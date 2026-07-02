# Security Policy

## Secrets & API keys

- **Never commit secrets.** `.env`, `*.env`, keys and credentials are gitignored;
  only `.env.example` (empty placeholders) is tracked. The repository history has
  been scanned and contains **no** API keys or credentials.
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
  reserved hosts, incl. the cloud metadata endpoint) — `app/core/net_guard.py`.
- SELECT-only SQL guard: single statement, no `INTO`, no dangerous functions, no
  `PRAGMA`/`ATTACH`/`DETACH`/`VACUUM` — `app/ai/sql_guard.py`.
- JWT signed HS256 with a fixed algorithm allowlist (no `alg=none` confusion).
- Per-IP rate limiting on `/auth/login`, `/auth/register`, public share routes and
  the collaboration WebSocket — `app/core/rate_limit.py`.
- Tier upgrades restricted to purchasable plans and gated behind a payment provider
  outside demo (no free self-escalation to unlimited) — `app/api/v1/billing.py`.
- Security headers on every response; `/metrics` restricted to loopback or a scrape
  token; interactive API docs disabled outside demo — `app/main.py`.
- Datasource connection strings encrypted at rest (Fernet); strong-secret startup
  checks in production.
- AutoML model blobs (`ml_models.model_blob`) are pickles of estimators trained
  by the server itself; they are written only by `automl_service.train`, read back
  only from our own database, never accepted from a client, and excluded from every
  API schema/response — `app/services/automl_service.py`.

## Reporting a vulnerability
Open a private security advisory on GitHub or email the maintainer. Please do not
file public issues for undisclosed vulnerabilities.
