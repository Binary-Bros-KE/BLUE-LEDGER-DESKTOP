import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  Eye,
  Loader2,
  Pencil,
  PieChart,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  Wallet,
  WalletCards
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
import type { Expense, ExpenseStatus, ExpenseSummary } from "@shared/types/expense";
import type { ExpenseCategory } from "@shared/types/expense-category";
import type { ExportListRequest } from "@shared/types/export";
import type { Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { RecurringBill } from "@shared/types/recurring-bill";
import { ExpenseCategoriesManagerModal } from "./expenses/ExpenseCategoriesManagerModal";
import { ExpenseFormModal } from "./expenses/ExpenseFormModal";
import { RecurringBillsModal } from "./expenses/RecurringBillsModal";

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

export function ExpensesRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("expenses", "create");
  const canEdit = can("expenses", "edit");
  const canDelete = can("expenses", "delete");
  const canManageCategories = can("expense_categories", "create") || can("expense_categories", "edit");
  const canExport = can("expenses", "export");

  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [storefrontFilter, setStorefrontFilter] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [categoriesManagerOpen, setCategoriesManagerOpen] = useState(false);
  const [recurringBillsModalOpen, setRecurringBillsModalOpen] = useState(false);
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [summaryResult, expenseList, categoryList, locationList, methodList, recurringBillList] = await Promise.all([
        window.blueLedger.expense.summary(),
        window.blueLedger.expense.list(),
        window.blueLedger.expenseCategory.list(),
        window.blueLedger.location.list(),
        window.blueLedger.paymentMethod.list(),
        window.blueLedger.recurringBill.list().catch(() => [])
      ]);
      setSummary(summaryResult);
      setExpenses(expenseList);
      setCategories(categoryList);
      setLocations(locationList);
      setPaymentMethods(methodList);
      setRecurringBills(recurringBillList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load expenses"));
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

  const filteredExpenses = useMemo(() => {
    if (!expenses) return null;
    let list = expenses;

    if (statusFilter !== "all") {
      list = list.filter((expense) => expense.status === statusFilter);
    }
    if (categoryFilter) {
      list = list.filter((expense) => expense.categoryId === categoryFilter);
    }
    if (storefrontFilter) {
      list = list.filter((expense) => expense.storefrontId === storefrontFilter);
    }
    if (paymentMethodFilter) {
      list = list.filter((expense) => expense.paymentMethodId === paymentMethodFilter);
    }
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      list = list.filter((expense) => new Date(expense.expenseDate).getTime() >= fromTime);
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
      list = list.filter((expense) => new Date(expense.expenseDate).getTime() <= toTime);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((expense) => {
        const haystack =
          `${expense.expenseNumber} ${expense.description ?? ""} ${expense.reference ?? ""} ${expense.paidBy ?? ""}`.toLowerCase();
        return haystack.includes(term);
      });
    }

    return list;
  }, [expenses, statusFilter, categoryFilter, storefrontFilter, paymentMethodFilter, dateFrom, dateTo, searchTerm]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredExpenses) return null;
    const filterParts: string[] = [];
    if (statusFilter !== "all") filterParts.push(`Status: ${statusFilter}`);
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
      module: "expenses",
      title: "Expenses",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "All expenses",
      columns: [
        { key: "expenseNumber", header: "Expense #" },
        { key: "date", header: "Date" },
        { key: "category", header: "Category" },
        { key: "storefront", header: "Storefront" },
        { key: "amount", header: "Amount", align: "right" },
        { key: "paymentMethod", header: "Payment Method" },
        { key: "paidBy", header: "Paid By" },
        { key: "createdBy", header: "Created By" }
      ],
      rows: filteredExpenses.map((expense) => ({
        expenseNumber: expense.expenseNumber,
        date: formatDate(expense.expenseDate),
        category: expense.categoryName,
        storefront: expense.storefrontName ?? "General",
        amount: formatCents(expense.amountCents),
        paymentMethod: expense.paymentMethodName,
        paidBy: expense.paidBy ?? "—",
        createdBy: expense.createdByName ?? "—"
      })),
      stats: summary
        ? [
            { label: "Today's Expenses", value: formatCents(summary.todayCents) },
            { label: "This Month's Expenses", value: formatCents(summary.thisMonthCents) },
            { label: "Total Expenses", value: formatCents(summary.totalCents) }
          ]
        : [],
      fileBaseName: `Expenses_${new Date().toISOString().slice(0, 10)}`
    };
  }, [
    filteredExpenses,
    summary,
    statusFilter,
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
    setEditingExpense(null);
    setFormOpen(true);
  }

  async function openEditModal(id: string): Promise<void> {
    setActionError(null);
    try {
      const expense = await window.blueLedger.expense.get(id);
      setEditingExpense(expense);
      setFormOpen(true);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load expense"));
    }
  }

  function handleCategoryCreated(category: ExpenseCategory): void {
    setCategories((prev) => [...prev, category]);
  }

  async function handleArchive(expense: Expense): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.expense.archive(expense.id);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to archive expense"));
    }
  }

  async function handleRestore(expense: Expense): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.expense.restore(expense.id);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to restore expense"));
    }
  }

  async function handleDelete(expense: Expense): Promise<void> {
    if (!window.confirm(`Delete ${expense.expenseNumber}? This can't be undone.`)) return;
    setActionError(null);
    try {
      await window.blueLedger.expense.delete(expense.id);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to delete expense"));
    }
  }

  const topCategories = summary?.byCategory.slice(0, 5) ?? [];
  const dueRecurringBills = recurringBills.filter(
    (bill) => bill.status === "active" && (bill.reminderStatus === "overdue" || bill.reminderStatus === "due_soon")
  );

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
          <StatTile icon={CalendarDays} label="Today's Expenses" value={formatCents(summary.todayCents)} tone="primary" />
          <StatTile icon={Wallet} label="This Month's Expenses" value={formatCents(summary.thisMonthCents)} tone="accent" />
          <StatTile icon={WalletCards} label="Total Expenses" value={formatCents(summary.totalCents)} tone="warning" />
          <div className="relative rounded-lg border border-line bg-white p-3.5 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Expenses by Category</p>
              <PieChart className="size-3.5 flex-none text-muted" aria-hidden="true" />
            </div>
            <div className="mt-2 space-y-1">
              {topCategories.length === 0 ? (
                <p className="text-xs font-semibold text-muted">No expenses recorded yet.</p>
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Expenses</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Wallet className="size-5 text-primary" aria-hidden="true" />
              Operational Expenses
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Money leaving the business for operational costs — independent of inventory and stock.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            <Button
              type="button"
              onClick={() => setRecurringBillsModalOpen(true)}
              className={cn(
                "h-9 border text-xs shadow-none",
                dueRecurringBills.length > 0
                  ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
                  : "border-line bg-white text-ink hover:bg-soft"
              )}
            >
              <Repeat className="mr-1.5 size-3.5" aria-hidden="true" />
              Recurring Bills{dueRecurringBills.length > 0 ? ` (${dueRecurringBills.length})` : ""}
            </Button>
            {canManageCategories && (
              <Button
                type="button"
                onClick={() => setCategoriesManagerOpen(true)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <Settings2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Manage Categories
              </Button>
            )}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Expense
              </Button>
            )}
          </div>
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        {dueRecurringBills.length > 0 && (
          <button
            type="button"
            onClick={() => setRecurringBillsModalOpen(true)}
            className="mt-4 flex w-full items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-left transition hover:bg-warning/15 cursor-pointer"
          >
            <AlertTriangle className="size-4 flex-none text-warning" aria-hidden="true" />
            <span className="text-xs font-bold text-ink">
              {dueRecurringBills.length} recurring bill{dueRecurringBills.length === 1 ? "" : "s"} need
              {dueRecurringBills.length === 1 ? "s" : ""} attention —{" "}
              {dueRecurringBills.map((bill) => bill.name).join(", ")}
            </span>
          </button>
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
                placeholder="Search expense #, description, reference, payer"
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
          {expenses === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Wallet className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No expenses yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Record your first operational expense to start tracking spending.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Expense
                </Button>
              )}
            </div>
          ) : filteredExpenses && filteredExpenses.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No expenses match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Try a different filter combination.</p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[1300px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Expense #</Th>
                    <Th>Date</Th>
                    <Th>Category</Th>
                    <Th>Storefront</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Payment Method</Th>
                    <Th>Paid By</Th>
                    <Th>Created By</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredExpenses ?? []).map((expense) => (
                    <tr
                      key={expense.id}
                      onClick={() => void openEditModal(expense.id)}
                      className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                        {expense.expenseNumber}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {formatDate(expense.expenseDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone="accent">{expense.categoryName}</DashedPill>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {expense.storefrontName ?? "General"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(expense.amountCents)}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {expense.paymentMethodName}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {expense.paidBy ?? "—"}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {expense.createdByName ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openEditModal(expense.id);
                            }}
                            aria-label={canEdit && expense.status === "active" ? "Edit expense" : "View expense"}
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            {canEdit && expense.status === "active" ? (
                              <Pencil className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Eye className="size-3.5" aria-hidden="true" />
                            )}
                          </button>
                          {canDelete && expense.status === "active" && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleArchive(expense);
                              }}
                              aria-label="Archive expense"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                            >
                              <Archive className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canDelete && expense.status === "archived" && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleRestore(expense);
                              }}
                              aria-label="Restore expense"
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

      <ExpenseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editingExpense={editingExpense}
        categories={categories}
        locations={locations}
        paymentMethods={paymentMethods}
        canEdit={canEdit}
        onCategoryCreated={handleCategoryCreated}
        onSaved={loadAll}
      />

      <ExpenseCategoriesManagerModal
        open={categoriesManagerOpen}
        onClose={() => setCategoriesManagerOpen(false)}
        categories={categories}
        canManage={canManageCategories}
        onChanged={loadAll}
      />

      <RecurringBillsModal
        open={recurringBillsModalOpen}
        onClose={() => {
          setRecurringBillsModalOpen(false);
          void loadAll();
        }}
        categories={categories}
        storefronts={locations}
        paymentMethods={paymentMethods}
        canManage={canCreate || canEdit}
      />
    </motion.div>
  );
}
