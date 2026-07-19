import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { ConfirmProvider } from "../shared/components/ConfirmModal";
import { App } from "./App";
import "../shared/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
    <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
  </React.StrictMode>
);
