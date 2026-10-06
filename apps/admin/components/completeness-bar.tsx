import "./completeness-bar.css";

export function CompletenessBar({ passed, total, label = "ความครบถ้วน" }: { passed: number; total: number; label?: string }) {
  const percent = total > 0 ? Math.floor(100 * passed / total) : 0;
  return <div className="completeness-bar" data-complete={total > 0 && passed === total}>
    <span>{label} {percent}%</span>
    <progress value={passed} max={Math.max(total, 1)} aria-label={label} />
    <small>{passed}/{total} รายการ</small>
  </div>;
}
