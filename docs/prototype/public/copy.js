for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.lastChild; const old = t.textContent; t.textContent = "Copied"; setTimeout(() => (t.textContent = old), 1600); } catch {}
  });
}
