import { Activity, AlertTriangle, AtSign, Sparkles, Sunrise, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NotificationCategory } from '../types'

interface CategoryMeta {
  label: string
  Icon: LucideIcon
}

// Single source of truth for how each notification category is labelled and iconified.
export const CATEGORY_META: Record<NotificationCategory, CategoryMeta> = {
  digest: { label: 'Brif', Icon: Sunrise },
  kpi_alert: { label: 'Alert', Icon: AlertTriangle },
  ai_quality: { label: 'AI Keyfiyyət', Icon: Activity },
  insight: { label: 'Insight', Icon: Sparkles },
  decision: { label: 'Qərar', Icon: Target },
  mention: { label: 'Qeyd', Icon: AtSign },
}

// Chip order, left to right.
export const CATEGORY_ORDER: NotificationCategory[] = [
  'digest',
  'kpi_alert',
  'ai_quality',
  'insight',
  'decision',
  'mention',
]
