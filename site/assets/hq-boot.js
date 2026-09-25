/* THE HQ PAGES' FIRST SCRIPT, run in the head before anything is drawn (a file, not inline, so
   the pages' Content-Security-Policy can refuse every inline script).

   · The theme: night first, the day shift if the visitor chose it (localStorage "cc_theme",
     the site's one stored value).
   · The HQ state the page starts in, so neither state flashes the other: with no HQ configured
     it is "offline" (the honest "coming online" panel); with one, the page's own starting
     state (data-hq-live: "loading", or "online" on the perks page), until its module has
     checked the origin and loaded. Reads assets/config.js, which loads first. */
(function () {
  const root = document.documentElement;
  let t = null;
  try { t = localStorage.getItem("cc_theme"); } catch {}
  root.dataset.theme = t === "light" ? "light" : "dark";
  const cfg = window.CIA_CONFIG;
  root.dataset.hq = cfg && cfg.hqApi ? root.dataset.hqLive || "loading" : "offline";
})();
