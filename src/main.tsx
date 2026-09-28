import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { AccountProvider } from "./lib/cloud/session";
import { consegnaRitornoPopup } from "./lib/google/auth";

// Prima di montare: se questa scheda è il popup tornato da Google, consegna il
// codice a chi lo ha aperto. Va prima del render perché la pagina del popup
// non deve restare aperta sull'app.
consegnaRitornoPopup();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountProvider>
      <App />
    </AccountProvider>
  </StrictMode>,
);
