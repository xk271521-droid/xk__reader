export function SidebarSection({ label, title, items = [], children }) {
  return (
    <section className="panel">
      <p className="panel-label">{label}</p>
      <h2>{title}</h2>
      {items.length > 0 ? (
        <ul className="feature-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </section>
  )
}
