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
- **Local pre-commit guard — install it.** This repository is public, so both of
  the controls above act too late or too narrowly to be the last line:

  - GitHub push protection blocks recognised *vendor* formats (`sk-…`, `AKIA…`,
    `ghp_…`). NexusBI's own `SECRET_KEY` and `FERNET_KEY` are random strings in
    no vendor's format and pass straight through it.
  - The gitleaks workflow scans everything, but only after the push has landed.
    On a public repository a secret is compromised the moment it is pushed; a red
    CI run reports the leak, it does not prevent it.

  ```bash
  git config core.hooksPath scripts/git-hooks
  ```

  [`scripts/git-hooks/pre-commit`](scripts/git-hooks/pre-commit) refuses any
  staged `.env*` (bar the `*.example` templates), `*.pem`, `*.key` or
  `.model_signing_key`, and runs `gitleaks protect --staged` when gitleaks is
  installed. Keep `.env` at mode `600` while you are there — the default `644`
  leaves it readable by every process running as any user on the machine.

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
- Losing workspace access closes the chat sockets you already hold. A room is
  authorised once, at connect, and never re-checked, so deleting the membership row
  alone left the socket streaming full message bodies until the client happened to
  disconnect. The hang-up is published over Redis so it reaches sockets held by
  *other* workers too — rooms live in per-process memory, so a local-only eviction
  covered whichever worker happened to serve the DELETE and no others —
  `app/realtime/hub.py`, `app/realtime/bus.py`.
- AutoML model blobs (`ml_models.model_blob`) are pickles of estimators trained
  by the server itself; they are written only by `automl_service.train`, read back
  only from our own database, never accepted from a client, and excluded from every
  API schema/response. As defense in depth each blob is HMAC-signed on write and
  verified before every `pickle.loads`, so a DB-write compromise can't smuggle a
  malicious pickle into code execution. The key comes from `MODEL_SIGNING_KEY`,
  falling back to `SECRET_KEY` when unset; rotating whichever one is in use
  invalidates existing blobs (retrain) — the same posture as `FERNET_KEY`. The two
  are separate settings because they rotate for different reasons: rotating the
  JWT key should log everyone out, not delete every trained model. In demo, where
  an unset `SECRET_KEY` is replaced per boot, the signing key is instead minted
  once and persisted under `UPLOAD_DIR` so stored models survive a restart —
  random per installation, never a constant in the repo —
  `app/services/automl_service.py`, `app/main.py`.
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
- **Rate-limit backing store.** Buckets now live in Redis (the shared
  `app.state.cache`) when it is reachable, so N workers enforce one limit rather
  than N × limit, and a restart no longer hands every client a fresh allowance.
  Without Redis — or when it fails to answer — the counter falls back to a
  per-process sliding window rather than failing open. Redis therefore *tightens*
  the limit and is not a dependency. Set `TRUSTED_PROXY_HOPS` to the real proxy
  count in production, or every client collapses into the proxy's bucket.
- **Connect datasources with a read-only database user.** Executing analyst-authored
  SQL is a feature, not a flaw, and it is guarded in depth: `validate_select_only`
  (single statement, `SELECT`/`WITH` only, function and catalog denylists) →
  `assert_tables_in_schema` (positive allowlist — only tables the datasource actually
  exposes) → row-level-security injection → a server-side `statement_timeout`, a row
  cap and a 30-per-minute rate limit. Every layer there is enforced in code.
  What no amount of application code can fix is that the *function* check is a
  **denylist**: it names the dangerous builtins it knows about, and a database
  engine can always ship one more. Granting the connection user `SELECT` and
  nothing else turns that from a race against a list into a property of the
  database, and costs nothing to do. Treat it as required for any datasource
  holding data you would not hand to whoever can log in.
- **Row-level security is deny-by-default on new sources.** Each datasource carries
  an `rls_mode`. On an `open` source a member with no rule sees every row — the
  original behaviour, and what every source that existed before this column got.
  On a `strict` source a member with no rule sees **no** rows: the query is wrapped
  so it returns zero rows before any aggregate is computed. Sources created from
  now on start `strict`; the owner flips either way from the RLS dialog.
  - The **owner is exempt from the strict deny only.** A rule that names them still
    applies — that instruction was explicit. Without the exemption, locking a source
    would lock its author out of their own data.
  - Anything that renders one dataset for a whole audience — public share links,
    embeds, the live-refresh broadcast — asks `rls_service.restricted_datasource_ids`
    before sending anything. A share token names no one, so a **locked** source is
    blanked outright, exactly as any source carrying a rule already was: an anonymous
    viewer can never hold a rule, so there is no scope to render them. The live loop
    can name its room (only the owner authenticates; guests arrive as `user_id=None`)
    and so blanks only what its actual audience is restricted on — it re-reads the
    roster at send time so a guest joining mid-refresh gets no owner-scoped rows.
  - Enforcement is in the SQL, never after the fetch: `rls_service.resolve_scope`
    decides the scope, `rls_sql.constrain_sql` filters before aggregation, and
    `rls_sql.deny_all_sql` produces the zero-row form. All three fail closed — SQL
    that cannot be parsed is rejected rather than run unconstrained.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting:** the *Report a vulnerability*
button under the repository's **Security** tab, or
<https://github.com/HeyderHesenov/NexusBI/security/advisories/new>. It opens a
draft advisory only the maintainer can see.

Please do not file a public issue for an undisclosed vulnerability — this
repository is public, so an issue discloses the finding to everyone the moment it
is filed, including before there is a fix.

⚠️ This paragraph asked for a private advisory before private vulnerability
reporting was actually switched on for the repository, which meant an outside
reporter had no such button and the only remaining route was email. The setting
is enabled now (verified via
`gh api repos/HeyderHesenov/NexusBI/private-vulnerability-reporting` →
`{"enabled": true}`), so the instruction and the repository agree. If the button
is missing, the setting was turned off again — say so in the report rather than
opening a public issue.
