/** Blue Ledger's signature dashboard layout — a wide content column plus a
 * narrower rail joined by a dashed timeline line with dot terminators. Every
 * dashboard variant renders into this same shell so the look stays identical
 * across roles; only the widgets inside `main`/`aside` differ. */
export function DashboardShell({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_380px] gap-5">
      <section className="space-y-5">{main}</section>

      <aside className="relative space-y-3.5 pl-4">
        <span
          className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
          aria-hidden="true"
        />
        {aside}
      </aside>
    </div>
  );
}
