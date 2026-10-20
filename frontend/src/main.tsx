import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { apply } from "./lib/appearance";
import "./index.css";

// Theme, accent and text size go on <html> before the first paint, so there's no flash.
apply();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support, faster starts and push notifications for the installed app (public/sw.js).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
