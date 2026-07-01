// Single source of truth for the manual-SQL history marker. The backend stamps
// query logs authored via the SQL editor with this prefix (query_service._sql_label);
// the frontend uses it to badge them and to keep them from being replayed as NL.
export const SQL_LABEL_PREFIX = '✎'

export const isSqlLabel = (text: string): boolean => text.startsWith(SQL_LABEL_PREFIX)

export const stripSqlLabel = (text: string): string =>
  text.replace(new RegExp(`^${SQL_LABEL_PREFIX}\\s*`), '')
