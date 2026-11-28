// <nyuchi-map>: the script form of the embed. It builds the same iframe the
// iframe snippet gives, so one path enforces the rule: the embed page decides
// who may frame it. It reads only its own attributes and no page data.
//
//   <script type="module" src="https://maps.nyuchi.com/assets/site/nyuchi-map.<hash>.js"></script>
//   <nyuchi-map style-name="light" center="31.05,-17.83" zoom="11" label="Map of Harare"></nyuchi-map>

const ORIGIN = new URL(import.meta.url).origin;
const NAMES = [
  "style-name",
  "center",
  "zoom",
  "markers",
  "controls",
  "lang",
  "label",
  "height",
];

class NyuchiMap extends HTMLElement {
  static observedAttributes = NAMES;
  #frame = null;

  connectedCallback() {
    this.#render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#render();
  }

  #render() {
    const url = new URL("/embed/", ORIGIN);
    const map = { "style-name": "style" };
    for (const name of [
      "style-name",
      "center",
      "zoom",
      "markers",
      "controls",
      "lang",
      "label",
    ]) {
      const value = this.getAttribute(name);
      if (value !== null && value !== "")
        url.searchParams.set(map[name] ?? name, value);
    }
    if (!this.#frame) {
      this.#frame = document.createElement("iframe");
      this.#frame.loading = "lazy";
      this.#frame.style.cssText = "display:block;width:100%;border:0";
      this.replaceChildren(this.#frame);
      this.style.display = "block";
    }
    const height = Number(this.getAttribute("height"));
    this.#frame.style.height = `${Number.isFinite(height) && height >= 120 && height <= 2000 ? height : 400}px`;
    this.#frame.title = this.getAttribute("label") || "Map";
    if (this.#frame.src !== url.href) this.#frame.src = url.href;
  }
}

if (!customElements.get("nyuchi-map"))
  customElements.define("nyuchi-map", NyuchiMap);
