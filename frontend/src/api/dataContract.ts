import { client } from './client'
import type { ContractRun, DataContract, DataContractCreate } from '../types'

export async function list(): Promise<DataContract[]> {
  const { data } = await client.get<DataContract[]>('/contracts/')
  return data
}

export async function create(payload: DataContractCreate): Promise<DataContract> {
  const { data } = await client.post<DataContract>('/contracts/', payload)
  return data
}

export async function run(id: string): Promise<DataContract> {
  const { data } = await client.post<DataContract>(`/contracts/${id}/run`)
  return data
}

export async function runs(id: string): Promise<ContractRun[]> {
  const { data } = await client.get<ContractRun[]>(`/contracts/${id}/runs`)
  return data
}

export async function remove(id: string): Promise<void> {
  await client.delete(`/contracts/${id}`)
}
