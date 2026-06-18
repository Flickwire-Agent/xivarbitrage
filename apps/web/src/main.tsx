import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }, 3000);
  });
}

void import("./ClientApp.js").then(({ ClientApp }) => {
  createRoot(document.getElementById("root")!).render(createElement(ClientApp));
});
