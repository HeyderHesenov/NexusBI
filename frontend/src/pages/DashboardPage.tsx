import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { SaveDashboardModal } from '../components/dashboard/SaveDashboardModal'
import { useDashboardStore } from '../store/dashboardStore'

export function DashboardPage() {
  const { list, current, loadList, open, create } = useDashboardStore()
  const [modal, setModal] = useState(false)

  useEffect(() => {
    loadList().catch(() => undefined)
  }, [loadList])

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="eyebrow">Kolleksiyalar</p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">Dashboard-lar</h2>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-1.5 rounded-xl bg-signal px-4 py-2 text-sm font-semibold text-brand shadow-key transition active:translate-y-0.5 active:shadow-none"
        >
          <Plus size={16} strokeWidth={2.5} /> Yeni
        </button>
      </div>

      {list.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {list.map((d) => (
            <button
              key={d.id}
              onClick={() => open(d.id)}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                current?.id === d.id
                  ? 'border-brand bg-brand text-white'
                  : 'border-grid bg-panel text-muted hover:border-brand hover:text-ink'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {current ? (
        <DashboardGrid dashboard={current} />
      ) : (
        <div className="plot-grid rounded-2xl border border-dashed border-grid px-6 py-16 text-center">
          <p className="font-display text-lg text-ink">Dashboard seç və ya yarat</p>
          <p className="mt-1 text-sm text-muted">
            Sorğularını bir yerə yığıb canlı panel düzəlt.
          </p>
        </div>
      )}

      <SaveDashboardModal
        open={modal}
        onClose={() => setModal(false)}
        onSave={async (name) => {
          await create(name)
          setModal(false)
        }}
      />
    </div>
  )
}
