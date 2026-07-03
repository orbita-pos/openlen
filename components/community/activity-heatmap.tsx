// Community-activity heatmap — one cell per day for ~52 weeks, coloured by how
// many pages the creator published publicly that day (from each page's
// listedAt). Pure server component; no client JS.

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};

const LEVELS = [
  "bg-white/[0.05]",
  "bg-[#ff5a36]/30",
  "bg-[#ff5a36]/55",
  "bg-[#ff5a36]/80",
  "bg-[#ff5a36]",
];
const level = (c: number) => (c === 0 ? 0 : c === 1 ? 1 : c <= 2 ? 2 : c <= 4 ? 3 : 4);

export default function ActivityHeatmap({ dates }: { dates: Date[] }) {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(dayKey(d), (counts.get(dayKey(d)) ?? 0) + 1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 7 * 52 * DAY_MS);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday

  const weeks: { key: string; count: number }[][] = [];
  let cursor = start.getTime();
  while (cursor <= today.getTime()) {
    const week: { key: string; count: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      const key = dayKey(d);
      week.push({ key, count: d <= today ? counts.get(key) ?? 0 : -1 });
      cursor += DAY_MS;
    }
    weeks.push(week);
  }

  const total = dates.length;
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-[3px]">
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {week.map((cell) => (
                <div
                  key={cell.key}
                  title={cell.count >= 0 ? `${cell.count} on ${cell.key}` : undefined}
                  className={`h-[11px] w-[11px] rounded-[2px] ${cell.count < 0 ? "bg-transparent" : LEVELS[level(cell.count)]}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
        <span>{total} {total === 1 ? "page" : "pages"} published in the last year</span>
        <span className="flex items-center gap-1">
          Less
          {LEVELS.map((c, i) => (
            <span key={i} className={`h-[10px] w-[10px] rounded-[2px] ${c}`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
