export function DashboardTiles({ tiles, counts, selected, onSelect, loading = false, label }: {
  tiles: { value: string; key: string; label: string }[]; counts?: Record<string, number>;
  selected: string; onSelect: (value: string) => void; loading?: boolean; label: string;
}) {
  return <div className="brand-completeness-tiles" role="group" aria-label={label}>{tiles.map(tile => <button key={tile.value} aria-pressed={selected === tile.value} disabled={loading} onClick={() => onSelect(tile.value)}><span>{tile.label}</span><strong>{loading ? "…" : counts?.[tile.key] ?? "—"}</strong></button>)}</div>;
}
