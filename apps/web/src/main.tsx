/** Point d'entrée : providers (toasts, session), routeur, service worker
 *  (production) et resynchronisation automatique de la file hors-ligne. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./store/auth";
import { ToastProvider } from "./store/toast";
import { installAutoSync } from "./lib/offline/sync";
import "./styles/global.css";

// Rejeu automatique des ventes hors-ligne (online, visibilité, intervalle).
installAutoSync();

// Coquille hors-ligne en production (jamais en dev : évite les caches fantômes).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* PWA indisponible : l'app reste utilisable */
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
