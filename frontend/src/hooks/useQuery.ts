import { useQueryStore } from '../store/queryStore'

export function useQuery() {
  const { result, loading, ask, setDatasource, datasourceId } = useQueryStore()
  return { result, loading, ask, setDatasource, datasourceId }
}
