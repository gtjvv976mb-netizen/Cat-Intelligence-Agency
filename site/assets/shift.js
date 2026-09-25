/* The night and day shift switch in the bar (a file, so a page's policy can refuse inline
   scripts). It flips data-theme on <html> and remembers the choice under "cc_theme". */
(function shiftSwitch() {
  const btn = document.getElementById("shiftbtn");
  if (!btn) return;
  const label = () => {
    const day = document.documentElement.dataset.theme === "light";
    btn.textContent = day ? "☀" : "☾";
    btn.title = day ? "Day shift. Click for the night shift." : "Night shift. Click for the day shift.";
  };
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cc_theme", next); } catch {}
    label();
  });
  label();
})();
