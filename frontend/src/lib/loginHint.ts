// Remembers the last successful email so the login form can offer it as a
// one-click suggestion. Only the email is stored — never the password.

const KEY = 'nexusbi_login_hint'

export interface LoginHint {
  email: string
}

export function readHint(): LoginHint | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LoginHint>
    if (typeof parsed?.email === 'string') {
      return { email: parsed.email }
    }
    return null
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
