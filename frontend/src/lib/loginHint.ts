// Remembers the last successful email so the login form can offer it as a
// one-click suggestion. Stored in localStorage — local convenience only.
//
// The password is intentionally NEVER stored: plaintext credentials at rest are
// an XSS / shared-machine credential-theft risk. readHint() also purges the
// password from any legacy {email,password} record it encounters.

const KEY = 'nexusbi_login_hint'

export interface LoginHint {
  email: string
}

export function readHint(): LoginHint | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.email !== 'string') return null
    // Legacy records stored the password in plaintext too. If we find one,
    // rewrite storage as email-only so the credential is purged from disk.
    if ('password' in parsed) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ email: parsed.email }))
      } catch {
        /* ignore */
      }
    }
    return { email: parsed.email }
  } catch {
    return null
  }
}

export function saveHint(email: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ email }))
  } catch {
    /* ignore */
  }
}

export function clearHint() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
