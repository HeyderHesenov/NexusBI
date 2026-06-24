import { Send } from 'lucide-react'
import { useState } from 'react'

interface Props {
  onSubmit: (q: string) => void
  loading: boolean
}

export function NLQueryInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState('')
  const submit = () => {
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Sualını yaz: Keçən rübdə ən çox satan 5 məhsul?"
        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-slate-100 focus:border-brand focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-brand px-4 py-2 font-medium text-slate-900 disabled:opacity-50"
      >
        <Send size={16} /> Soruş
      </button>
    </div>
  )
}
