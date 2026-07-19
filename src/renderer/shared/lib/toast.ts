import toast from "react-hot-toast";

const baseStyle: React.CSSProperties = {
  background: "#fffdf7",
  color: "#1c1710",
  border: "1px solid #ddd5c2",
  borderRadius: "10px",
  boxShadow: "0 18px 40px rgba(28, 22, 8, 0.18)",
  fontFamily: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  fontSize: "13px",
  fontWeight: 700,
  padding: "12px 14px",
  maxWidth: "380px"
};

/** Only for outcomes the user actually triggered (create/update/delete/complete/etc.) — never for
 * routine page-load fetches. Error toasts are a supplement to the persistent error banners already
 * shown inline in each form, not a replacement — a toast disappears if the user looks away. */
export function showSuccessToast(message: string): void {
  toast.success(message, {
    style: baseStyle,
    iconTheme: { primary: "#15915f", secondary: "#fffdf7" }
  });
}

export function showErrorToast(message: string): void {
  toast.error(message, {
    style: { ...baseStyle, border: "1px solid #ad3a29" },
    iconTheme: { primary: "#ad3a29", secondary: "#fffdf7" },
    duration: 5000
  });
}
