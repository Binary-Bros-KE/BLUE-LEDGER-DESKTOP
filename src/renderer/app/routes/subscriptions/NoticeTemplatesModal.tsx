import { useEffect, useState } from "react";
import { Button } from "@renderer/shared/components/Button";
import { TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { showSuccessToast } from "@renderer/shared/lib/toast";
import {
  DEFAULT_NOTICE_TEMPLATES,
  SUBSCRIPTION_NOTICE_LABELS,
  SUBSCRIPTION_NOTICE_STAGES,
  type SubscriptionNoticeStage
} from "@shared/lib/subscription-schedule";
import { loadNoticeTemplates, saveNoticeTemplates } from "./subscription-ui";

const PLACEHOLDERS = ["{customer}", "{service}", "{account}", "{end_date}", "{days}", "{business}"];

/** The ready-written message for each reminder. Saved on this PC; an empty one falls back to the default. */
export function NoticeTemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [templates, setTemplates] = useState<Record<SubscriptionNoticeStage, string>>(DEFAULT_NOTICE_TEMPLATES);

  useEffect(() => {
    if (open) setTemplates(loadNoticeTemplates());
  }, [open]);

  function save(): void {
    saveNoticeTemplates(templates);
    showSuccessToast("Reminder messages saved");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Reminder Messages" description="The message each reminder starts with. You can still edit it before sending." widthClassName="max-w-2xl">
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted">
          Fill-ins: {PLACEHOLDERS.map((placeholder) => <code key={placeholder} className="mr-1.5 rounded bg-soft px-1 py-0.5 text-[11px] text-ink">{placeholder}</code>)}
        </p>
        {SUBSCRIPTION_NOTICE_STAGES.map((stage) => (
          <TextAreaField
            key={stage}
            label={SUBSCRIPTION_NOTICE_LABELS[stage]}
            value={templates[stage]}
            onChange={(value) => setTemplates((prev) => ({ ...prev, [stage]: value }))}
            rows={3}
          />
        ))}
        <div className="flex justify-between gap-2 border-t border-line pt-4">
          <Button
            type="button"
            onClick={() => setTemplates({ ...DEFAULT_NOTICE_TEMPLATES })}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Restore defaults
          </Button>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button type="button" onClick={save} className="h-9 text-xs">
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
