import { useStore } from "../game/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="feed">
      {toasts.map((t) => (
        <div key={t.key} className={`feed-item ${t.mine ? "mine" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
