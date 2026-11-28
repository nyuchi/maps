// Runs in <head> before first paint: apply a saved theme (no flash) and mark
// that scripts run, so script-only controls can appear. localStorage only,
// never a cookie.
document.documentElement.dataset.js = "";
try {
  const t = localStorage.getItem("nyuchi-maps-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  // Storage is blocked: the page follows the system for this visit.
}
