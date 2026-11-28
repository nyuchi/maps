// Apply a saved theme before first paint (no flash). localStorage only, never a cookie.
try {
  const t = localStorage.getItem("nyuchi-maps-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {}
