import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Copy, Loader2, Mail } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { NewsletterSubscriber } from "@shared/types/online-store";

/** Website newsletter sign-ups ("Get the Latest Deals" on the Adia home), newest first — with a
 * one-click copy of every address, to paste into an email tool. */
export function NewsletterPanel(): React.JSX.Element {
  const [rows, setRows] = useState<NewsletterSubscriber[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    window.blueLedger.onlineStore
      .newsletterList()
      .then(setRows)
      .catch((err) => setError(getErrorMessage(err, "Couldn't load subscribers")));
  }, []);

  const shown = useMemo(() => (rows ?? []).filter((r) => r.email.includes(search.trim().toLowerCase())), [rows, search]);

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shown.map((r) => r.email).join(", "));
      showSuccessToast(`Copied ${shown.length} email${shown.length === 1 ? "" : "s"}`);
    } catch {
      showErrorToast("Couldn't copy — select and copy them manually");
    }
  }

  if (error) return <p className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm font-bold text-danger">{error}</p>;
  if (!rows)
    return (
      <div className="flex min-h-[160px] items-center justify-center text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );

  return (
    <div className="rounded-lg border border-line bg-white shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wide text-ink">Newsletter subscribers</p>
          <p className="text-xs font-semibold text-muted">{rows.length} sign-up{rows.length === 1 ? "" : "s"} from your website</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email"
            className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void copyAll()}
            disabled={shown.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-xs font-extrabold uppercase tracking-wide text-white transition hover:bg-primary disabled:opacity-40"
          >
            <Copy className="size-3.5" /> Copy emails
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 p-6 text-sm font-semibold text-muted">
          <Mail className="size-4" /> {rows.length === 0 ? "No one has signed up yet." : "No emails match that search."}
        </p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
          {shown.map((r) => (
            <li key={r.email} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="font-semibold text-ink">{r.email}</span>
              <span className="text-xs font-semibold text-muted">{format(new Date(r.createdAt), "d MMM yyyy")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
