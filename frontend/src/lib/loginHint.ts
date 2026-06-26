// Remembers the last successful email/password so the login form can offer it
// as a one-click suggestion. Stored in localStorage (plaintext) — local convenience only.

const KEY = 'nexusbi_login_hint'

export interface LoginHint {
  email: string
  password: string
}

export function readHint(): LoginHint | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LoginHint>
    if (typeof parsed?.email === 'string' && typeof parsed?.password === 'string') {
      return { email: parsed.email, password: parsed.password }
    }
    return null
  } catch {
    return null
  }
}

export function saveHint(email: string, password: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ email, password }))
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
