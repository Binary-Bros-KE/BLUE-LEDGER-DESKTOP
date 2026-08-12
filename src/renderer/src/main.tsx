import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { ConfirmProvider } from "../shared/components/ConfirmModal";
import { App } from "./App";
import { PdfPreviewApp } from "./PdfPreviewApp";
import "../shared/styles/globals.css";

// This renderer bundle has no router — the normal app is a single Zustand-driven view switcher (see
// App.tsx). A PDF preview window is a SECOND instance of this same bundle (see openPdfPreviewWindow
// in printer-service.ts), and must never boot the full app shell — it doesn't have a logged-in
// session, doesn't need one, and hydrate()/auth checks would just spin forever or bounce to the login
// screen. The `#/pdf-preview/<id>` hash the preview window is opened with is the one signal available
// to tell the two apart before anything else runs.
// Chromium silently increments/decrements a focused number input on ANY wheel scroll — including
// when the user is just scrolling past it to reach something else — so a value can change without
// the user ever noticing. Blurring (without preventDefault) removes focus before Chromium's default
// spin behavior applies, so the value stays put and the page/list keeps scrolling normally.
window.addEventListener(
  "wheel",
  () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type === "number") {
      active.blur();
    }
  },
  { passive: true }
);

const previewId = /^#\/pdf-preview\/(.+)$/.exec(window.location.hash)?.[1];

if (previewId) {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PdfPreviewApp previewId={decodeURIComponent(previewId)} />
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
    </React.StrictMode>
  );
} else {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
    </React.StrictMode>
  );
}
