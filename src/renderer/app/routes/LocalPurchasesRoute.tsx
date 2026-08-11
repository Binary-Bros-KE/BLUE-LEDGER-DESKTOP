import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  CalendarDays,
  Eye,
  Loader2,
  Pencil,
  PieChart,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import {
  ALL_YEARS_VALUE,
  buildAvailableYears,
  currentYear,
  matchesYearFilter,
  yearFilterOptions
} from "@renderer/shared/lib/year-filter";
import type { Expense, ExpenseSummary } from "@shared/types/expense";
import type { ExpenseCategory } from "@shared/types/expense-category";
import type { ExportListRequest } from "@shared/types/export";
import type { Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import { LocalPurchaseFormModal } from "./local-purchases/LocalPurchaseFormModal";

type StatusFilter = "active" | "archived" | "all";

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function LocalPurchasesRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("local_purchases", "create");
  const canEdit = can("local_purchases", "edit");
  const canDelete = can("local_purchases", "delete");
  const canExport = can("local_purchases", "export");

  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [purchases, setPurchases] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));
  const [categoryFilter, setCategoryFilter] = useState("");
  const [storefrontFilter, setStorefrontFilter] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Expense | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [summaryResult, purchaseList, categoryList, locationList, methodList] = await Promise.all([
        window.blueLedger.localPurchase.summary(),
        window.blueLedger.localPurchase.list(),
        window.blueLedger.expenseCategory.list(),
        window.blueLedger.location.list(),
        window.blueLedger.paymentMethod.list()
      ]);
      setSummary(summaryResult);
      setPurchases(purchaseList);
      setCategories(categoryList);
      setLocations(locationList);
      setPaymentMethods(methodList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load daily expenses"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const availableYears = useMemo(() => buildAvailableYears((purchases ?? []).map((purchase) => purchase.expenseDate)), [purchases]);

  const filteredPurchases = useMemo(() => {
    if (!purchases) return null;
    let list = purchases;

    if (statusFilter !== "all") {
      list = list.filter((purchase) => purchase.status === statusFilter);
    }
    list = list.filter((purchase) => matchesYearFilter(purchase.expenseDate, yearFilter));
    if (categoryFilter) {
      list = list.filter((purchase) => purchase.categoryId === categoryFilter);
    }
    if (storefrontFilter) {
      list = list.filter((purchase) => purchase.storefrontId === storefrontFilter);
    }
    if (paymentMethodFilter) {
      list = list.filter((purchase) => purchase.paymentMethodId === paymentMethodFilter);
    }
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      list = list.filter((purchase) => new Date(purchase.expenseDate).getTime() >= fromTime);
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
      list = list.filter((purchase) => new Date(purchase.expenseDate).getTime() <= toTime);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((purchase) => {
        const haystack =
          `${purchase.expenseNumber} ${purchase.description ?? ""} ${purchase.reference ?? ""} ${purchase.paidBy ?? ""}`.toLowerCase();
        return haystack.includes(term);
      });
    }

    return list;
  }, [purchases, statusFilter, yearFilter, categoryFilter, storefrontFilter, paymentMethodFilter, dateFrom, dateTo, searchTerm]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredPurchases) return null;
    const filterParts: string[] = [];
    if (statusFilter !== "all") filterParts.push(`Status: ${statusFilter}`);
    if (yearFilter !== ALL_YEARS_VALUE) filterParts.push(`Year: ${yearFilter}`);
    if (categoryFilter) {
      filterParts.push(`Category: ${categories.find((c) => c.id === categoryFilter)?.name ?? categoryFilter}`);
    }
    if (storefrontFilter) {
      filterParts.push(`Storefront: ${locations.find((l) => l.id === storefrontFilter)?.locationName ?? storefrontFilter}`);
    }
    if (paymentMethodFilter) {
      filterParts.push(
        `Payment Method: ${paymentMethods.find((m) => m.id === paymentMethodFilter)?.name ?? paymentMethodFilter}`
      );
    }
    if (dateFrom || dateTo) filterParts.push(`Date: ${dateFrom || "…"} to ${dateTo || "…"}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);

    return {
      module: "local_purchases",
      title: "Daily Expenses",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All daily expenses",
      columns: [
        { key: "expenseNumber", header: "Purchase #" },
        { key: "date", header: "Date" },
        { key: "category", header: "Category" },
        { key: "storefront", header: "Storefront" },
        { key: "amount", header: "Amount", align: "right" },
        { key: "paymentMethod", header: "Payment Method" },
        { key: "paidBy", header: "Bought By" },
        { key: "createdBy", header: "Created By" }
      ],
      rows: filteredPurchases.map((purchase) => ({
        expenseNumber: purchase.expenseNumber,
        date: formatDate(purchase.expenseDate),
        category: purchase.categoryName,
        storefront: purchase.storefrontName ?? "General",
        amount: formatCents(purchase.amountCents),
        paymentMethod: purchase.paymentMethodName,
        paidBy: purchase.paidBy ?? "—",
        createdBy: purchase.createdByName ?? "—"
      })),
      stats: summary
        ? [
          { label: "Today's Daily Expenses", value: formatCents(summary.todayCents) },
          { label: "This Month's Daily Expenses", value: formatCents(summary.thisMonthCents) },
          { label: "Total Daily Expenses", value: formatCents(summary.totalCents) }
        ]
        : [],
      fileBaseName: `Daily_Expenses_${new Date().toISOString().slice(0, 10)}`
    };
  }, [
    filteredPurchases,
    summary,
    statusFilter,
    yearFilter,
    categoryFilter,
    storefrontFilter,
    paymentMethodFilter,
    dateFrom,
    dateTo,
    searchTerm,
    categories,
    locations,
    paymentMethods
  ]);

  function clearFilters(): void {
    setSearchTerm("");
    setStatusFilter("active");
    setCategoryFilter("");
    setStorefrontFilter("");
    setPaymentMethodFilter("");
    setDateFrom("");
    setDateTo("");
  }

  function openCreateModal(): void {
    setEditingPurchase(null);
    setFormOpen(true);
  }

  async function openEditModal(id: string): Promise<void> {
    setActionError(null);
    try {
      const purchase = await window.blueLedger.localPurchase.get(id);
      setEditingPurchase(purchase);
      setFormOpen(true);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load daily expense"));
    }
  }

  async function handleArchive(purchase: Expense): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.localPurchase.archive(purchase.id);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to archive daily expense"));
    }
  }

  async function handleRestore(purchase: Expense): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.localPurchase.restore(purchase.id);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to restore daily expense"));
    }
  }

  const topCategories = summary?.byCategory.slice(0, 5) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
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

      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={CalendarDays} label="Today's Daily Expenses" value={formatCents(summary.todayCents)} tone="primary" />
          <StatTile icon={ShoppingBag} label="This Month's Daily Expenses" value={formatCents(summary.thisMonthCents)} tone="accent" />
          <StatTile icon={ShoppingBag} label="Total Daily Expenses" value={formatCents(summary.totalCents)} tone="warning" />
          <div className="relative rounded-lg border border-line bg-white p-3.5 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">By Category</p>
              <PieChart className="size-3.5 flex-none text-muted" aria-hidden="true" />
            </div>
            <div className="mt-2 space-y-1">
              {topCategories.length === 0 ? (
                <p className="text-xs font-semibold text-muted">No daily expenses recorded yet.</p>
              ) : (
                topCategories.map((entry) => (
                  <div key={entry.categoryId} className="flex items-center justify-between text-xs">
                    <span className="truncate font-bold text-ink">{entry.categoryName}</span>
                    <span className="flex-none font-bold tabular-nums text-muted">{formatCents(entry.totalCents)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Daily Expenses</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ShoppingBag className="size-5 text-primary" aria-hidden="true" />
              Day-to-Day Buys
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Small local buys.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Daily Expense
              </Button>
            )}
          </div>
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block sm:col-span-2 lg:col-span-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search purchase #, description, reference, buyer"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>

          <div className="flex gap-1.5 rounded-lg border border-line bg-soft px-1 py-0.5">
            {(["active", "archived", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                  statusFilter === value ? "bg-primary text-white" : "text-muted hover:bg-white"
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <SelectField
            label="Year"
            value={yearFilter}
            onChange={setYearFilter}
            options={yearFilterOptions(availableYears)}
          />
          <SelectField
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "", label: "All Categories" },
              ...categories.map((category) => ({ value: category.id, label: category.name }))
            ]}
          />
          <SelectField
            label="Storefront"
            value={storefrontFilter}
            onChange={setStorefrontFilter}
            options={[
              { value: "", label: "All Storefronts" },
              ...locations.map((location) => ({ value: location.id, label: location.locationName }))
            ]}
          />
          <SelectField
            label="Payment Method"
            value={paymentMethodFilter}
            onChange={setPaymentMethodFilter}
            options={[
              { value: "", label: "All Payment Methods" },
              ...paymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
          />
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From Date</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To Date</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
        </div>

        <div className="mt-5">
          {purchases === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : purchases.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ShoppingBag className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No daily expenses yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Record the first day-to-day buy to start tracking it.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Daily Expense
                </Button>
              )}
            </div>
          ) : filteredPurchases && filteredPurchases.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No daily expenses match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Try a different filter combination.</p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Purchase #</Th>
                    <Th>Date</Th>
                    <Th>Category</Th>
                    <Th>Storefront</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Payment Method</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredPurchases ?? []).map((purchase) => (
                    <tr
                      key={purchase.id}
                      onClick={() => void openEditModal(purchase.id)}
                      className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {purchase.expenseNumber}
                          </span>
                          <span className="text-xs text-muted font-bold">
                            {formatDate(purchase.expenseDate)}
                          </span>
                        </div>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone="accent">{purchase.categoryName}</DashedPill>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {purchase.storefrontName ?? "General"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(purchase.amountCents)}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {purchase.paymentMethodName}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openEditModal(purchase.id);
                            }}
                            aria-label={canEdit && purchase.status === "active" ? "Edit daily expense" : "View daily expense"}
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            {canEdit && purchase.status === "active" ? (
                              <Pencil className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Eye className="size-3.5" aria-hidden="true" />
                            )}
                          </button>
                          {canDelete && purchase.status === "active" && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleArchive(purchase);
                              }}
                              aria-label="Archive daily expense"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                            >
                              <Archive className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canDelete && purchase.status === "archived" && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRestore(purchase);
                              }}
                              aria-label="Restore daily expense"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-success/15 hover:text-success cursor-pointer"
                            >
                              <RotateCcw className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <LocalPurchaseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editingPurchase={editingPurchase}
        categories={categories}
        locations={locations}
        paymentMethods={paymentMethods}
        canEdit={canEdit}
        onSaved={loadAll}
      />
    </motion.div>
  );
}
