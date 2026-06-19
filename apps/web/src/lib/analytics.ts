const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;

if (domain && import.meta.env.PROD) {
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://plausible.io/js/script.js";
  script.dataset.domain = domain;
  document.head.appendChild(script);
}
