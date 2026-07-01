import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Plus, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { Field, FIELD, Select } from '../components/ui/form'

function fmt(ts: string): string {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts)
  return new Date(hasTz ? ts : `${ts}Z`).toLocaleString('az-AZ', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

const ROLES = ['viewer', 'editor', 'owner']

export function WorkspacePage() {
  const { t } = useTranslation()
  const {
    workspaces, members, audit, load, create, loadMembers, addMember, removeMember, loadAudit,
  } = useWorkspaceStore()
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')

  useEffect(() => {
    load().catch(() => undefined)
    loadAudit().catch(() => undefined)
  }, [load, loadAudit])

  const toggle = (id: string) => {
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    loadMembers(id).catch(() => undefined)
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('workspacePage.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('workspacePage.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t('workspacePage.subtitle')}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) {
            create(name.trim()).catch(() => undefined)
            setName('')
          }
        }}
        className="mb-6 rounded-2xl border border-line bg-surface p-5"
      >
        <p className="eyebrow mb-4">{t('workspacePage.newWorkspace')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field id="ws-name" label={t('workspacePage.nameLabel')}>
              <input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workspacePage.newWorkspacePlaceholder')}
                className={FIELD}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={!name.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
          >
            <Plus size={15} /> {t('workspacePage.create')}
          </button>
        </div>
      </form>

      {workspaces.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <Users size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('workspacePage.emptyWorkspaces')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {workspaces.map((w) => (
            <li key={w.id} className="rounded-2xl border border-line bg-surface p-4">
              <button onClick={() => toggle(w.id)} className="flex w-full items-center justify-between gap-3 text-left">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <Users size={16} className="text-accent" /> {w.name}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {t(`workspacePage.role_${w.role}`, w.role ?? '')}
                </span>
              </button>

              {openId === w.id && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  {(members[w.id] ?? []).map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink">{m.email}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase text-ink-soft">
                          {t(`workspacePage.role_${m.role}`, m.role ?? '')}
                        </span>
                        {w.role === 'owner' && m.user_id !== w.owner_id && (
                          <button
                            onClick={() => removeMember(w.id, m.id)}
                            className="rounded-md border border-line p-1 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                  {w.role === 'owner' && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (email.trim()) {
                          addMember(w.id, email.trim(), role).catch(() => undefined)
                          setEmail('')
                        }
                      }}
                      className="grid gap-3 pt-2 sm:grid-cols-[1fr_11rem_auto] sm:items-end"
                    >
                      <Field id={`ws-email-${w.id}`} label={t('workspacePage.memberEmailLabel')}>
                        <input
                          id={`ws-email-${w.id}`}
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={t('workspacePage.memberEmailPlaceholder')}
                          className={FIELD}
                        />
                      </Field>
                      <Field id={`ws-role-${w.id}`} label={t('workspacePage.roleLabel')}>
                        <Select
                          id={`ws-role-${w.id}`}
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          options={ROLES.map((r) => ({
                            value: r,
                            label: t(`workspacePage.role_${r}`, r),
                          }))}
                        />
                      </Field>
                      <button
                        type="submit"
                        disabled={!email.trim()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-50"
                      >
                        <UserPlus size={14} /> {t('workspacePage.addMember')}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <History size={16} className="text-accent" />
          <h2 className="font-display text-lg font-semibold text-ink">{t('workspacePage.auditLog')}</h2>
        </div>
        {audit.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('workspacePage.emptyAudit')}</p>
        ) : (
          <ul className="space-y-1.5">
            {audit.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Shield size={13} className="text-ink-faint" />
                  <code className="font-mono text-xs text-ink">{a.action}</code>
                  {a.entity && <span className="text-ink-faint">· {a.entity}</span>}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {fmt(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
