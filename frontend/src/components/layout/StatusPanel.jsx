export function StatusPanel({ label }) {
  return (
    <div className="status-panel">
      <span className="status-dot" />
      <span>{label}</span>
    </div>
  )
}
