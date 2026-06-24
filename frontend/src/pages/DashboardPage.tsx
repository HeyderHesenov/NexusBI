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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">Dashboard-lar</h2>
        <button
          onClick={() => setModal(true)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-slate-900"
        >
          Yeni Dashboard
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {list.map((d) => (
          <button
            key={d.id}
            onClick={() => open(d.id)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:border-brand"
          >
            {d.name}
          </button>
        ))}
      </div>

      {current && <DashboardGrid dashboard={current} />}

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
