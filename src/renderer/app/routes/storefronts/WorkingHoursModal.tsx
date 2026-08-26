import { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField, SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { WorkingHoursInput } from "@shared/schemas/working-hours";
import type { WorkingHoursLockMode, WorkingHoursSchedule } from "@shared/types/working-hours";

// Displayed Monday-first (how a business actually thinks about its week) even though the
// underlying keys are "0".."6" = Sunday..Saturday, matching JS Date.getDay()/getUTCDay() —
// the same convention computeWorkingHoursLockStatus reads.
const DAYS: Array<{ key: string; label: string }> = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" }
];

const LOCK_MODE_OPTIONS: Array<{ value: WorkingHoursLockMode; label: string }> = [
  { value: "auto", label: "Automatic — lock outside the hours below" },
  { value: "manual", label: "Manual — I'll lock/unlock it myself" }
];

function emptySchedule(): WorkingHoursSchedule {
  const schedule: WorkingHoursSchedule = {};
  for (const day of DAYS) {
    schedule[day.key] = { isOpen: true, openTime: "08:00", closeTime: "18:00" };
  }
  return schedule;
}

function emptyForm(): WorkingHoursInput {
  return {
    lockEnabled: false,
    lockMode: "auto",
    manuallyLocked: false,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    schedule: emptySchedule()
  };
}

export function WorkingHoursModal({
  open,
  onClose,
  locationId,
  locationName
}: {
  open: boolean;
  onClose: () => void;
  locationId: string;
  locationName: string;
}): React.JSX.Element {
  const [form, setForm] = useState<WorkingHoursInput>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.blueLedger.workingHours
      .get(locationId)
      .then((existing) => {
        if (cancelled) return;
        if (!existing) {
          setForm(emptyForm());
          return;
        }
        setForm({
          lockEnabled: existing.lockEnabled,
          lockMode: existing.lockMode,
          manuallyLocked: existing.manuallyLocked,
          timezoneOffsetMinutes: existing.timezoneOffsetMinutes,
          schedule: existing.schedule
        });
      })
      .catch((err) => {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load working hours");
          setError(message);
          showErrorToast(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, locationId]);

  function updateDay(dayKey: string, patch: Partial<WorkingHoursSchedule[string]>): void {
    setForm((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, [dayKey]: { ...prev.schedule[dayKey], ...patch } as WorkingHoursSchedule[string] }
    }));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await window.blueLedger.workingHours.upsert(locationId, form);
      showSuccessToast("Working hours saved");
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save working hours");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Working Hours"
      description={`Lock ${locationName} outside business hours — only your Super Admin can still get in while it's locked.`}
      widthClassName="max-w-lg"
    >
      {loading ? (
        <div className="flex min-h-[180px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
          )}

          <CheckboxField
            label="Lock outside working hours"
            description="Everyone except your Super Admin loses access while this storefront is locked."
            checked={form.lockEnabled}
            onChange={(checked) => setForm((prev) => ({ ...prev, lockEnabled: checked }))}
          />

          {form.lockEnabled && (
            <>
              <SelectField
                label="Lock mode"
                value={form.lockMode}
                onChange={(value) => setForm((prev) => ({ ...prev, lockMode: value as WorkingHoursLockMode }))}
                options={LOCK_MODE_OPTIONS}
                className="mt-4"
              />

              {form.lockMode === "manual" ? (
                <div className="mt-4">
                  <CheckboxField
                    label="Currently locked"
                    description="Flip this off to unlock the system right now — the schedule below is ignored entirely in manual mode."
                    checked={form.manuallyLocked}
                    onChange={(checked) => setForm((prev) => ({ ...prev, manuallyLocked: checked }))}
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {DAYS.map((day) => {
                    const value = form.schedule[day.key] ?? { isOpen: true, openTime: "08:00", closeTime: "18:00" };
                    return (
                      <div key={day.key} className="flex items-center gap-3 rounded-lg border border-line bg-soft px-3 py-2">
                        <label className="flex w-28 flex-none cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={value.isOpen}
                            onChange={(event) => updateDay(day.key, { isOpen: event.target.checked })}
                            className="size-4 flex-none accent-primary"
                          />
                          <span className="text-xs font-bold text-ink">{day.label}</span>
                        </label>
                        {value.isOpen ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              type="time"
                              value={value.openTime ?? "08:00"}
                              onChange={(event) => updateDay(day.key, { openTime: event.target.value })}
                              className="h-8 w-full rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
                            />
                            <span className="text-xs font-bold text-muted">to</span>
                            <input
                              type="time"
                              value={value.closeTime ?? "18:00"}
                              onChange={(event) => updateDay(day.key, { closeTime: event.target.value })}
                              className="h-8 w-full rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
                            />
                          </div>
                        ) : (
                          <span className="flex-1 text-xs font-semibold text-muted">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-line bg-soft/60 p-3">
                <Clock className="mt-0.5 size-4 flex-none text-muted" aria-hidden="true" />
                <p className="text-xs font-semibold text-muted">
                  Hours are based on this device&apos;s own timezone. The Owner mobile app can also configure this storefront&apos;s working
                  hours.
                </p>
              </div>
            </>
          )}

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving..." : "Save working hours"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
