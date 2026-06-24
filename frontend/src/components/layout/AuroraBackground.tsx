/**
 * Aurora glow — slow-drifting blurred emerald/graphite light blobs.
 * GPU-friendly (only transform/opacity animate); frozen under reduced-motion.
 */
export function AuroraBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="aurora-blob aurora-1" />
      <div className="aurora-blob aurora-2" />
      <div className="aurora-blob aurora-3" />
      {/* Keeps the canvas calm and readable above the glow. */}
      <div className="absolute inset-0 bg-bg/40" />
    </div>
  )
}
