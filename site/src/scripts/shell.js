// Progressive enhancement for the dashboard frame. Without this script every
// page still reads and navigates: the theme follows the system, the collapse
// toggle is the shell's own checkbox, and copy buttons stay hidden.
const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");
const effective = () => root.dataset.theme ?? (dark.matches ? "dark" : "light");

// Old links to the map page (/#4/10/20, /?lang=fr) keep working: the map is
// the Explorer now.
if (location.pathname === "/") {
  const mapHash = /^#\d+(\.\d+)?\/-?\d+(\.\d+)?\/-?\d+(\.\d+)?/.test(
    location.hash,
  );
  if (mapHash || new URLSearchParams(location.search).has("lang")) {
    location.replace(`/explorer/${location.search}${location.hash}`);
  }
}

// Theme: a round icon button in the sidebar footer. The choice is kept in
// localStorage (never a cookie) and announced to the page as "themechange".
const themeBtn = document.querySelector("[data-theme-toggle]");
if (themeBtn) {
  themeBtn.hidden = false;
  const label = () =>
    themeBtn.setAttribute(
      "aria-label",
      effective() === "dark"
        ? "Switch to the light theme"
        : "Switch to the dark theme",
    );
  label();
  themeBtn.addEventListener("click", () => {
    const next = effective() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("nyuchi-maps-theme", next);
    } catch {
      // Storage is blocked: the choice lasts for this visit only.
    }
    label();
    window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });
  dark.addEventListener("change", () => {
    if (!root.dataset.theme) {
      label();
      window.dispatchEvent(
        new CustomEvent("themechange", { detail: effective() }),
      );
    }
  });
}

// Collapse: the shell's checkbox stays the source of truth; a real button
// with aria-expanded replaces its label so assistive technology hears a
// button, not a checkbox. TODO(mzizi): this should be the shell's behaviour.
const box = document.querySelector("[data-shell-collapse]");
const lab = box && document.querySelector(`label[for="${box.id}"]`);
if (box && lab) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    lab.className.replace(/\bcursor-pointer\b/, "") + " cursor-pointer";
  for (const node of lab.childNodes) {
    if (!(node instanceof Element && node.classList.contains("sr-only")))
      btn.append(node.cloneNode(true));
  }
  const sidebar = box
    .closest("[data-slot=app-shell]")
    ?.querySelector("[data-slot=app-sidebar]");
  if (sidebar?.id) btn.setAttribute("aria-controls", sidebar.id);
  const sync = () => {
    btn.setAttribute("aria-expanded", String(!box.checked));
    const text = box.checked ? "Expand navigation" : "Collapse navigation";
    btn.setAttribute("aria-label", text);
    btn.title = text;
  };
  sync();
  btn.addEventListener("click", () => box.click());
  box.addEventListener("change", sync);
  box.setAttribute("aria-hidden", "true");
  box.tabIndex = -1;
  lab.replaceWith(btn);
}

// Copy buttons: data-copy="text" or data-copy-from="#id" (the text of that element).
const live = document.createElement("div");
live.className = "sr-only";
live.setAttribute("role", "status");
document.body.append(live);
document.addEventListener("click", async (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest("[data-copy], [data-copy-from]")
      : null;
  if (!button) return;
  const source = button.dataset.copyFrom
    ? document.getElementById(button.dataset.copyFrom)
    : null;
  const text = source ? source.textContent : button.dataset.copy;
  if (!text) return;
  const caption = button.querySelector("[data-copy-label]");
  try {
    await navigator.clipboard.writeText(text);
    live.textContent = "Copied to the clipboard";
    if (caption) {
      const old = caption.textContent;
      caption.textContent = "Copied";
      setTimeout(() => {
        caption.textContent = old;
        live.textContent = "";
      }, 1600);
    }
  } catch {
    live.textContent = "Could not copy: select the text and copy it";
  }
});
