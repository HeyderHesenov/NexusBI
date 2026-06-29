import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Palette, Save } from 'lucide-react'
import * as branding from '../api/branding'

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function BrandingPage() {
  const [appName, setAppName] = useState('NexusBI')
  const [color, setColor] = useState('#0E9F6E')
  const [logo, setLogo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    branding
      .getBrand()
      .then((b) => {
        setAppName(b.app_name)
        setColor(b.primary_color)
        setLogo(b.logo_url)
      })
      .catch(() => undefined)
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      await branding.putBrand({ app_name: appName, primary_color: color, logo_url: logo })
      toast.success('Brendinq yadda saxlanıldı.')
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">White-label</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Brendinq</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Embed olunmuş panellərdə görünən ad, rəng və loqonu təyin et.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        {/* Form */}
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <div>
            <p className="eyebrow mb-1">Tətbiq adı</p>
            <input value={appName} onChange={(e) => setAppName(e.target.value)} className={field} />
          </div>
          <div>
            <p className="eyebrow mb-1">Əsas rəng</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface-2"
              />
              <input value={color} onChange={(e) => setColor(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <p className="eyebrow mb-1">Loqo URL (ixtiyari)</p>
            <input
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="https://…/logo.svg"
              className={field}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs text-ink-faint">
              <Palette size={13} /> Embed (iframe / SDK) görünüşünə tətbiq olunur.
            </span>
            <button
              onClick={save}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
            >
              <Save size={15} /> {busy ? 'Saxlanır…' : 'Yadda saxla'}
            </button>
          </div>
        </div>

        {/* Live embed preview */}
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
          <div className="flex items-center gap-2.5 border-b border-line px-5 py-4" style={{ borderTopColor: color, borderTopWidth: 3 }}>
            {logo ? (
              <img src={logo} alt={appName} className="h-7 w-auto" />
            ) : (
              <span className="font-display text-lg font-bold text-ink">{appName}</span>
            )}
            <span
              className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              Nümunə düymə
            </span>
          </div>
          <div className="space-y-3 p-5">
            <p className="eyebrow">Önizləmə · embed paneli</p>
            <div className="h-3 w-2/3 rounded-full bg-line" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="mb-2 h-2 w-12 rounded-full bg-line" />
                  <div className="h-6 w-16 rounded" style={{ backgroundColor: color, opacity: 0.85 }} />
                </div>
              ))}
            </div>
            <div className="flex h-32 items-end gap-2 rounded-xl border border-line bg-surface p-3">
              {[40, 70, 55, 90, 65, 80].map((h, i) => (
                <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, backgroundColor: color, opacity: 0.85 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
