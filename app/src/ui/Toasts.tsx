import { useStore } from "../game/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const route = useStore((s) => s.route);
  if (route.page !== "room") return null;
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
