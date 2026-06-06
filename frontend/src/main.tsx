import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { initTheme } from "@/theme/themes";
import "@/styles/index.css";

initTheme(); // apply the persisted theme before first paint (no flash)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
