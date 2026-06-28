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
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <p className="eyebrow">White-label</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Brendinq</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Embed olunmuş panellərdə görünən ad, rəng və loqonu təyin et.
        </p>
      </header>

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

        {/* Preview */}
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="eyebrow mb-2">Önizləmə</p>
          <div className="flex items-center gap-2.5">
            {logo ? (
              <img src={logo} alt={appName} className="h-6 w-auto" />
            ) : (
              <span className="font-display text-base font-bold text-ink">{appName}</span>
            )}
            <span
              className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              Nümunə düymə
            </span>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            <Save size={15} /> {busy ? 'Saxlanır…' : 'Yadda saxla'}
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
        <Palette size={13} /> Bu parametrlər embed (iframe / SDK) görünüşünə tətbiq olunur.
      </div>
    </div>
  )
}
