export default function StatBar({ name, value }: { name: string; value: number }) {
  return (
    <div className="stat-row">
      <div className="stat-label">
        <span style={{ textTransform: "capitalize" }}>{name}</span>
        <span>{value}</span>
      </div>
      <div className="stat-bar">
        <div className={`stat-fill ${name}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
