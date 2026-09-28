import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import ErroreAvvio from "./components/ErroreAvvio";
import { AccountProvider } from "./lib/cloud/session";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Fuori da tutto il resto: senza, un errore in una qualsiasi vista
        smonterebbe l'albero e lascerebbe una finestra bianca — sul desktop,
        dove non c'è una console, anche senza sapere che c'è stato un errore. */}
    <ErroreAvvio>
      <AccountProvider>
        <App />
      </AccountProvider>
    </ErroreAvvio>
  </StrictMode>,
);
