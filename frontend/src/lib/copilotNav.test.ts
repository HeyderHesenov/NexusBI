import { describe, expect, it } from 'vitest'
import { copilotNavTarget } from './copilotNav'
import type { CopilotAction } from '../api/copilot'

const a = (over: Partial<CopilotAction>): CopilotAction => ({ type: 'x', label: '', ...over })

describe('copilotNavTarget', () => {
  it('deep-opens created AutoML models and BA artifacts', () => {
    expect(copilotNavTarget(a({ ml_model_id: 'm1' }))).toBe('/automl?open=m1')
    expect(copilotNavTarget(a({ ba_artifact_id: 'b1' }))).toBe('/ba-studio?open=b1')
  })

  it('routes every id-keyed chip', () => {
    expect(copilotNavTarget(a({ experiment_id: 'e' }))).toBe('/experiments')
    expect(copilotNavTarget(a({ decision_id: 'd' }))).toBe('/decisions')
    expect(copilotNavTarget(a({ contract_id: 'c' }))).toBe('/contracts')
    expect(copilotNavTarget(a({ dashboard_id: 'd' }))).toBe('/dashboards')
    expect(copilotNavTarget(a({ query_log_id: 'q' }))).toBe('/history')
    expect(copilotNavTarget(a({ saved_query_id: 's' }))).toBe('/reports')
    expect(copilotNavTarget(a({ metric_id: 'm' }))).toBe('/metrics')
  })

  it('routes type-keyed chips without their own object page', () => {
    expect(copilotNavTarget(a({ type: 'insight' }))).toBe('/insights')
    expect(copilotNavTarget(a({ type: 'metric_tree' }))).toBe('/metric-tree')
    expect(copilotNavTarget(a({ type: 'twin' }))).toBe('/twin')
    expect(copilotNavTarget(a({ type: 'digest' }))).toBe('/notifications')
  })

  it('unknown chips do not navigate', () => {
    expect(copilotNavTarget(a({ type: 'widget' }))).toBeNull()
  })
})
