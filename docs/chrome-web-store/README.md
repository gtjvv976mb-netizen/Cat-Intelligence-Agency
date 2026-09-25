# The Chrome Web Store kit

Everything needed to put the Cat Intelligence Agency extension in the Chrome Web Store. It is
**not in the store yet**; until it is, the site's [Downloads page](https://catintelligenceagency.com/downloads/)
serves the zip to load unpacked.

| File | What |
|---|---|
| [listing.md](listing.md) | The name, the short description (at most 132 characters), the detailed description, the category, the links and the pictures |
| [privacy.md](privacy.md) | The single purpose, where every piece of data goes and why, the dashboard's data answers, and a privacy policy to publish |
| [permissions.md](permissions.md) | A justification for every permission, host permission and page match in `manifest.json` |
| [screenshots/](screenshots/) | The popup, the options page and the setup page at 1280 × 800, from the merged build |
| `../../scripts/store-screenshots.mjs` | Loads `dist/` in Chromium and writes those screenshots again |

All three documents describe the merged extension (`manifest.json` 0.1.0, five cats) and were
checked against its code: every permission, every host it calls and every cat that calls it.
`test-hawk-manifest.mjs` checks the listing's short description is the manifest's.

## How to submit

1. **Recheck.** `npm ci && npm run build && npm test`. If `manifest.json` changed since these
   files were written, diff it against [permissions.md](permissions.md) and justify anything
   new; check [privacy.md](privacy.md) and [listing.md](listing.md) against what the extension
   does. Consider dropping the development-only console matches (`localhost`, `127.0.0.1`,
   `claudedotcompany.com`) from the store build.
2. **Verify the zip.** `node scripts/package.mjs && node scripts/verify-download.mjs`: it loads
   the zip in Chromium, opens every page, and fails on any error. Then
   `node scripts/package.mjs --placeholder` before any commit.
3. **The screenshots** are in [screenshots/](screenshots/); take them again with
   `node scripts/store-screenshots.mjs` if the pages changed. Look at them: they show a fresh
   install, with nothing set up.
4. **Open a developer account.** Sign in to the Chrome Web Store Developer Dashboard
   (`https://chrome.google.com/webstore/devconsole`) with the Google account that should own the
   listing, pay the one-time registration fee (US$5), and verify the contact email. Publishing
   also needs 2-Step Verification on that account.
5. **Publish the privacy policy** from [privacy.md](privacy.md) at a URL of its own, such as a
   page on `catintelligenceagency.com`. The dashboard will not submit without one.
6. **Upload the zip.** New item → upload `cat-intelligence-agency-extension.zip`: the one the
   site serves, or the one attached to the version's GitHub release (`git tag v<version> && git push origin v<version>`
   makes it). `manifest.json` is at its root, as the store requires; `INSTALL.txt` beside it is
   harmless.
7. **Fill in the listing:** the text, category and language from [listing.md](listing.md); the
   128 px icon; the screenshots; a 440 × 280 small promo tile (crop one from `brand/banner/`);
   the homepage and support URLs.
8. **Fill in privacy:** the single purpose, a justification per permission (from
   [permissions.md](permissions.md)), "No" to remote code, the data boxes and the three
   certifications, and the privacy policy URL (all from [privacy.md](privacy.md)).
9. **Choose distribution** (public or unlisted, and the regions), then **submit for review**.
   Broad host permissions (`https://*/*`) mean an in-depth review, which takes longer; the
   reviewer may ask for narrower ones ([permissions.md](permissions.md) says how).

### Before and after it is live

- **Trademark.** The name "CoinMarketCat" may draw a trademark question from the review or
  from CoinMarketCap. The listing and the site say it is not affiliated with CoinMarketCap; be
  ready to rename that cat if asked. Popcat and Crying Cat are also the names of well-known memes,
  which a reviewer may ask about.
- **A new ID.** A store install has its own fixed extension ID, which is not the ID of any copy
  loaded unpacked (that one comes from the folder's path). So nothing carries over: someone moving
  from the unpacked copy to the store sets it up again, and should first withdraw from any wallet
  the unpacked copy made, or export its key.
- **The site.** The Downloads page says "Not yet in the Chrome Web Store", and `test-site.mjs`
  pins that. Change both only once the listing is live, and link the listing then.
