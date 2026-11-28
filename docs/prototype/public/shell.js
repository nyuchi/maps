// Progressive enhancement for two shell controls. Without this script both still work:
// the theme follows the system and the collapse toggle is the shell's own checkbox.
const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");
const effective = () => root.dataset.theme ?? (dark.matches ? "dark" : "light");

// Theme: a round icon button in the sidebar footer.
const themeBtn = document.querySelector("[data-theme-toggle]");
if (themeBtn) {
  themeBtn.hidden = false;
  const label = () => themeBtn.setAttribute("aria-label", effective() === "dark" ? "Switch to the light theme" : "Switch to the dark theme");
  label();
  themeBtn.addEventListener("click", () => {
    const next = effective() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("nyuchi-maps-theme", next); } catch {}
    label();
    window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });
  dark.addEventListener("change", () => { if (!root.dataset.theme) { label(); window.dispatchEvent(new CustomEvent("themechange", { detail: effective() })); } });
}

// Collapse: the shell's checkbox stays the source of truth; a real button with aria-expanded
// replaces its label so assistive technology hears a button, not a checkbox.
const box = document.querySelector("[data-shell-collapse]");
const lab = box && document.querySelector(`label[for="${box.id}"]`);
if (box && lab) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = lab.className.replace(/\bcursor-pointer\b/, "") + " cursor-pointer";
  btn.innerHTML = lab.innerHTML.replace(/<span class="sr-only">.*?<\/span>/, "");
  btn.setAttribute("aria-controls", box.closest("[data-slot=app-shell]")?.querySelector("[data-slot=app-sidebar]")?.id ?? "");
  const sync = () => {
    btn.setAttribute("aria-expanded", String(!box.checked));
    btn.setAttribute("aria-label", box.checked ? "Expand navigation" : "Collapse navigation");
    btn.title = btn.getAttribute("aria-label");
  };
  sync();
  btn.addEventListener("click", () => box.click());
  box.addEventListener("change", sync);
  box.setAttribute("aria-hidden", "true");
  box.tabIndex = -1;
  lab.replaceWith(btn);
}
