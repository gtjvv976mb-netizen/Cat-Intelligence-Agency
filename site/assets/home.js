/* The home page's small jobs: fill the placeholders from the one config, and open an
   agent's file in a panel (from a kitten in the 3D agency, or from a card).

   Every value in window.CIA_CONFIG is checked before it is used. An empty or odd value
   leaves its control as the page ships it: a disabled button that says so, an empty slot. */
(function () {
  const cfg = window.CIA_CONFIG || {};
  const clean = (v) => (typeof v === "string" ? v.trim() : "");

  const X_URL = /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/;
  const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const xUrl = X_URL.test(clean(cfg.xUrl)) ? clean(cfg.xUrl) : "";
  const ca = MINT.test(clean(cfg.contractAddress)) ? clean(cfg.contractAddress) : "";
  // The buy link must be the pump.fun page of that same address, or it is not used.
  const buy = clean(cfg.buyUrl);
  const buyUrl = ca && /^https:\/\/pump\.fun\//.test(buy) && buy.includes(ca) ? buy : "";

  const toLink = (btn, href, label) => {
    const a = document.createElement("a");
    a.className = btn.className;
    a.href = href;
    a.rel = "noopener";
    a.textContent = label;
    btn.replaceWith(a);
  };

  if (xUrl) {
    for (const btn of document.querySelectorAll("button[data-x-link]")) toLink(btn, xUrl, btn.dataset.label || "Follow on X");
  }
  if (ca) {
    const slot = document.getElementById("ca");
    if (slot) { slot.textContent = ca; slot.dataset.empty = "false"; }
  }
  if (buyUrl) {
    const btn = document.getElementById("buybtn");
    if (btn) toLink(btn, buyUrl, "Buy $CIA on pump.fun");
  }

  /* ── an agent's file, in a panel ─────────────────────────────────────── */
  const dialog = document.getElementById("dossier");
  if (!dialog || typeof dialog.showModal !== "function") {
    // No <dialog>: scroll to the card instead.
    document.addEventListener("cia:dossier", (e) => {
      const card = document.getElementById("agent-" + e.detail.cat);
      if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.focus?.(); }
    });
    return;
  }
  const slot = dialog.querySelector(".dossier-slot");
  let opener = null;
  const open = (cat) => {
    const card = document.getElementById("agent-" + cat);
    if (!card) return;
    const copy = card.cloneNode(true);
    copy.removeAttribute("id");
    copy.classList.add("in-dossier");
    for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
    for (const img of copy.querySelectorAll("img")) img.loading = "eager";
    // On a wide screen the kitten in a file stands at exactly twice its size (Popcat, holding
    // its radar out, at one and a half), so every art pixel stays square and sharp.
    const kit = copy.querySelector(".agent-floor .kitten");
    if (kit && matchMedia("(min-width:641px) and (min-height:620px)").matches) {
      const s = cat === "popcat" ? 1.5 : 2;
      kit.style.width = Number(kit.getAttribute("width")) * s + "px";
      kit.style.height = Number(kit.getAttribute("height")) * s + "px";
    }
    const file = copy.querySelector("details.file");
    if (file) file.open = true;
    const title = copy.querySelector("h3");
    if (title) { title.id = "dossier-title"; dialog.setAttribute("aria-labelledby", "dossier-title"); }
    slot.replaceChildren(copy);
    dialog.style.setProperty("--accent", card.style.getPropertyValue("--accent") || "#14f195");
    opener = document.activeElement;
    dialog.showModal();
    dialog.scrollTop = 0;
    // Side by side, the kitten's column is as tall as the file, or the panel, whichever is
    // shorter, and never shorter than the kitten standing on its floor.
    const floor = copy.querySelector(".agent-floor"), body = copy.querySelector(".agent-body");
    if (floor && body && getComputedStyle(copy).flexDirection === "row") {
      const standing = kit ? kit.offsetHeight + 110 : 0;
      floor.style.height = Math.max(360, standing, Math.min(body.offsetHeight, dialog.clientHeight)) + "px";
    }
  };
  document.addEventListener("cia:dossier", (e) => open(e.detail.cat));
  dialog.querySelector(".dossier-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    slot.replaceChildren();
    if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
  });
})();
