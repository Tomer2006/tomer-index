export function finishInitialLoad() {
  const app = document.getElementById("app");
  app?.removeAttribute("aria-busy");
  document.body.classList.remove("is-loading");
  document.querySelector(".page-loader")?.remove();
}
