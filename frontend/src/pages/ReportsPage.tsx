import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { BellPlus, Clock, Mail, Play, Trash2, BookMarked } from 'lucide-react'
import { useSavedQueryStore } from '../store/savedQueryStore'
import { ModalShell } from '../components/ui/ModalShell'
import { Field, Select } from '../components/ui/form'
import * as alertApi from '../api/alert'
import * as subApi from '../api/reportSubscription'
import type { ReportFormat, ReportSchedule, Subscription } from '../api/reportSubscription'
import type { AlertOperator, Schedule } from '../types'

const SCHEDULES: { value: Schedule; labelKey: string }[] = [
  { value: 'off', labelKey: 'reportsPage.scheduleOff' },
  { value: 'hourly', labelKey: 'reportsPage.scheduleHourly' },
  { value: 'daily', labelKey: 'reportsPage.scheduleDaily' },
  { value: 'weekly', labelKey: 'reportsPage.scheduleWeekly' },
]

export function ReportsPage() {
  const { t } = useTranslation()
  const fmt = (ts: string | null): string => {
    if (!ts) return t('reportsPage.never')
    return new Date(ts).toLocaleString('az-AZ', { dateStyle: 'short', timeStyle: 'short' })
  }
  const { items, load, run, remove, setSchedule } = useSavedQueryStore()
  const [alertFor, setAlertFor] = useState<{ id: string; name: string } | null>(null)
  const [deliverFor, setDeliverFor] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('reportsPage.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          {t('reportsPage.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t('reportsPage.subtitle')}
        </p>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <BookMarked size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('reportsPage.emptyTitle')}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {t('reportsPage.emptyHint')}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="truncate text-sm text-ink-soft">“{s.nl_query}”</p>
                  <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-faint">
                    <Clock size={11} /> {t('reportsPage.lastRun')}: {fmt(s.last_run_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <select
                    value={s.schedule}
                    onChange={(e) => setSchedule(s.id, e.target.value as Schedule)}
                    className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink-soft focus:border-accent focus:outline-none"
                  >
                    {SCHEDULES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => run(s.id)}
                    title={t('reportsPage.runNow')}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                  >
                    <Play size={15} />
                  </button>
                  <button
                    onClick={() => setAlertFor({ id: s.id, name: s.name })}
                    title={t('reportsPage.setAlert')}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                  >
                    <BellPlus size={15} />
                  </button>
                  <button
                    onClick={() => setDeliverFor({ id: s.id, name: s.name })}
                    title={t('reportsPage.deliveryTitle')}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                  >
                    <Mail size={15} />
                  </button>
                  <button
                    onClick={() => remove(s.id)}
                    title={t('reportsPage.delete')}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {alertFor && (
        <AlertModal
          savedQueryId={alertFor.id}
          savedQueryName={alertFor.name}
          onClose={() => setAlertFor(null)}
        />
      )}

      {deliverFor && (
        <DeliveryModal
          savedQueryId={deliverFor.id}
          savedQueryName={deliverFor.name}
          onClose={() => setDeliverFor(null)}
        />
      )}
    </div>
  )
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'
const OPERATORS: AlertOperator[] = ['>', '<', '>=', '<=', '==', '!=']

function AlertModal({
  savedQueryId,
  savedQueryName,
  onClose,
}: {
  savedQueryId: string
  savedQueryName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [column, setColumn] = useState('')
  const [operator, setOperator] = useState<AlertOperator>('>')
  const [threshold, setThreshold] = useState('0')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !column.trim() || busy) return
    setBusy(true)
    try {
      await alertApi.createAlert({
        saved_query_id: savedQueryId,
        name: name.trim(),
        column: column.trim(),
        operator,
        threshold: Number(threshold) || 0,
      })
      toast.success(t('reportsPage.alertCreated'))
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title={t('reportsPage.setAlert')}
      subtitle={t('reportsPage.alertSubtitle', { name: savedQueryName })}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('reportsPage.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {t('reportsPage.create')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <Field id="alert-name" label={t('reportsPage.alertNameLabel')}>
          <input
            id="alert-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('reportsPage.namePlaceholder')}
            className={field}
          />
        </Field>
        <Field id="alert-column" label={t('reportsPage.columnLabel')}>
          <input
            id="alert-column"
            value={column}
            onChange={(e) => setColumn(e.target.value)}
            placeholder={t('reportsPage.columnPlaceholder')}
            className={`${field} font-mono text-sm`}
          />
        </Field>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field id="alert-operator" label={t('reportsPage.operatorLabel')}>
            <Select
              id="alert-operator"
              value={operator}
              onChange={(e) => setOperator(e.target.value as AlertOperator)}
              options={OPERATORS.map((o) => ({ value: o, label: o }))}
            />
          </Field>
          <Field id="alert-threshold" label={t('reportsPage.thresholdLabel')}>
            <input
              id="alert-threshold"
              type="number"
              step="any"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={t('reportsPage.thresholdPlaceholder')}
              className={`${field} font-mono`}
            />
          </Field>
        </div>
      </div>
    </ModalShell>
  )
}

const DELIVERY_SCHEDULES: { value: ReportSchedule; labelKey: string }[] = [
  { value: 'hourly', labelKey: 'reportsPage.scheduleHourly' },
  { value: 'daily', labelKey: 'reportsPage.scheduleDaily' },
  { value: 'weekly', labelKey: 'reportsPage.scheduleWeekly' },
]

function DeliveryModal({
  savedQueryId,
  savedQueryName,
  onClose,
}: {
  savedQueryId: string
  savedQueryName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [recipient, setRecipient] = useState('')
  const [format, setFormat] = useState<ReportFormat>('pdf')
  const [schedule, setSchedule] = useState<ReportSchedule>('daily')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    subApi.listSubscriptions(savedQueryId).then(setSubs).catch(() => undefined)
  }, [savedQueryId])

  const add = async () => {
    if (!recipient.trim() || busy) return
    setBusy(true)
    try {
      const sub = await subApi.createSubscription(savedQueryId, {
        recipient: recipient.trim(),
        format,
        schedule,
      })
      setSubs((prev) => [...prev, sub])
      setRecipient('')
      toast.success(t('reportsPage.deliveryCreated'))
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const del = async (id: string) => {
    await subApi.deleteSubscription(id).catch(() => undefined)
    setSubs((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title={t('reportsPage.deliveryTitle')}
      subtitle={t('reportsPage.deliverySubtitle', { name: savedQueryName })}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('reportsPage.close')}
          </button>
          <button
            onClick={add}
            disabled={busy || !recipient.trim()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {t('reportsPage.add')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {subs.length > 0 && (
          <ul className="space-y-1.5">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-ink">{s.recipient}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {s.format} · {s.schedule}
                </span>
                <button onClick={() => del(s.id)} aria-label={t('reportsPage.delete')} className="shrink-0 text-ink-faint transition hover:text-[#D87C6B]">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field id="del-recipient" label={t('reportsPage.recipientLabel')}>
          <input
            id="del-recipient"
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={t('reportsPage.emailPlaceholder')}
            className={field}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="del-format" label={t('reportsPage.formatLabel')}>
            <Select
              id="del-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ReportFormat)}
              options={[
                { value: 'pdf', label: 'PDF' },
                { value: 'xlsx', label: 'Excel' },
              ]}
            />
          </Field>
          <Field id="del-schedule" label={t('reportsPage.scheduleLabel')}>
            <Select
              id="del-schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as ReportSchedule)}
              options={DELIVERY_SCHEDULES.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            />
          </Field>
        </div>
      </div>
    </ModalShell>
  )
}
