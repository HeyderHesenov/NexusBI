/** Trigger a browser download for a Blob under the given filename.
 *  One canonical implementation shared by CSV export, chart/graph image export,
 *  etc. — so the object-URL lifecycle (create → click → revoke) lives in one place. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
