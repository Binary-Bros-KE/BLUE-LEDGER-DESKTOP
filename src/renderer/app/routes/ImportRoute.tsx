import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField } from "@renderer/shared/components/form-fields";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { ColumnMappingStep } from "@renderer/app/routes/import/ColumnMappingStep";
import { EntityPicker } from "@renderer/app/routes/import/EntityPicker";
import { ImportPreviewTable } from "@renderer/app/routes/import/ImportPreviewTable";
import { ImportResultsPanel } from "@renderer/app/routes/import/ImportResultsPanel";
import { autoMatchColumnMapping } from "@renderer/app/routes/import/field-aliases";
import {
  IMPORT_FIELD_DEFINITIONS,
  type ImportColumnMapping,
  type ImportCommitResult,
  type ImportEntityType,
  type ImportParsedFile,
  type ImportPreviewResult
} from "@shared/types/import";

type WizardStep = "entity" | "file" | "map" | "results";

export function ImportRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCommit = can("data_import", "edit");

  const [step, setStep] = useState<WizardStep>("entity");
  const [entityType, setEntityType] = useState<ImportEntityType>("products");
  const [parsedFile, setParsedFile] = useState<ImportParsedFile | null>(null);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [moneyInCents, setMoneyInCents] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = IMPORT_FIELD_DEFINITIONS[entityType];

  const refreshPreview = useCallback(
    async (nextMapping: ImportColumnMapping, file: ImportParsedFile, nextMoneyInCents: boolean) => {
      setLoadingPreview(true);
      setError(null);
      try {
        const result = await window.blueLedger.import.preview({
          entityType,
          rows: file.rows,
          columnMapping: nextMapping,
          moneyInCents: nextMoneyInCents
        });
        setPreview(result);
      } catch (err) {
        setError(getErrorMessage(err, "Failed to preview the file"));
      } finally {
        setLoadingPreview(false);
      }
    },
    [entityType]
  );

  // Debounced live preview whenever the mapping (or the cents toggle) changes — mirrors the
  // mapping table so the user sees the create/update/error split update as they adjust things.
  useEffect(() => {
    if (step !== "map" || !parsedFile) return;
    const timeout = setTimeout(() => void refreshPreview(mapping, parsedFile, moneyInCents), 300);
    return () => clearTimeout(timeout);
  }, [mapping, moneyInCents, parsedFile, step, refreshPreview]);

  async function handlePickFile(): Promise<void> {
    setLoadingFile(true);
    setError(null);
    try {
      const file = await window.blueLedger.import.pickFile(entityType);
      if (!file) return;
      setParsedFile(file);
      setMapping(autoMatchColumnMapping(fields, file.headers));
      setStep("map");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to read that file"));
    } finally {
      setLoadingFile(false);
    }
  }

  async function handleCommit(): Promise<void> {
    if (!parsedFile) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await window.blueLedger.import.commit({
        entityType,
        rows: parsedFile.rows,
        columnMapping: mapping,
        moneyInCents
      });
      setCommitResult(result);
      setStep("results");
    } catch (err) {
      setError(getErrorMessage(err, "Import failed"));
    } finally {
      setCommitting(false);
    }
  }

  function startOver(): void {
    setStep("entity");
    setParsedFile(null);
    setMapping({});
    setMoneyInCents(false);
    setPreview(null);
    setCommitResult(null);
    setError(null);
  }

  const importableCount = preview ? preview.summary.toCreate + preview.summary.toUpdate : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-6 space-y-5 pb-10"
    >
      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Blue Ledger Management</p>
        <h2 className="mt-1 text-xl font-extrabold">Data Import</h2>
        <p className="mt-1 text-xs font-semibold text-muted">
          Bulk-load Products, Customers, or Suppliers from a CSV or Excel file — a row matching an
          existing record (by SKU / phone / business name) updates it instead of creating a duplicate.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {error}
        </div>
      )}

      {step === "entity" && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">1. What are you importing?</h3>
          <div className="mt-3">
            <EntityPicker value={entityType} onChange={setEntityType} />
          </div>
          <Button className="mt-4 cursor-pointer" onClick={() => setStep("file")}>
            Continue
          </Button>
        </div>
      )}

      {step === "file" && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">2. Choose a file</h3>
          <p className="mt-1 text-xs font-semibold text-muted">
            CSV or Excel (.xlsx) — the first row must be column headers.
          </p>
          <Button
            className="mt-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loadingFile}
            onClick={() => void handlePickFile()}
          >
            {loadingFile ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-2 size-4" aria-hidden="true" />
            )}
            {loadingFile ? "Reading..." : "Choose File"}
          </Button>
        </div>
      )}

      {step === "map" && parsedFile && (
        <>
          <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">3. Map columns</h3>
                <p className="mt-1 text-xs font-semibold text-muted">
                  {parsedFile.fileName} · {parsedFile.rows.length} rows
                </p>
              </div>
              {canCommit && preview && preview.mappingErrors.length === 0 && (
                <Button
                  className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={committing || importableCount === 0}
                  onClick={() => void handleCommit()}
                >
                  {committing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileSpreadsheet className="mr-2 size-4" aria-hidden="true" />
                  )}
                  {committing ? "Importing..." : `Import ${importableCount} rows`}
                </Button>
              )}
            </div>

            <div className="mt-4">
              <ColumnMappingStep fields={fields} headers={parsedFile.headers} mapping={mapping} onChange={setMapping} />
            </div>

            <div className="mt-4">
              <CheckboxField
                label="Amounts in this file are already in cents"
                description="Turn this on only if the money columns hold raw integer cents (e.g. a direct export of Blue Ledger's own database) instead of normal decimal amounts like 150.00."
                checked={moneyInCents}
                onChange={setMoneyInCents}
              />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Preview</h3>
              {loadingPreview && <Loader2 className="size-3.5 animate-spin text-muted" aria-hidden="true" />}
            </div>
            {preview && preview.mappingErrors.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm font-bold text-danger">
                {preview.mappingErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : preview ? (
              <div className="mt-3">
                <ImportPreviewTable result={preview} />
              </div>
            ) : null}
          </div>
        </>
      )}

      {step === "results" && commitResult && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">Import complete</h3>
            <Button className="cursor-pointer" onClick={startOver}>
              Import Another File
            </Button>
          </div>
          <div className="mt-4">
            <ImportResultsPanel result={commitResult} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
