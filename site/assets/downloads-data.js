/* THE DOWNLOADS PAGE'S NUMBERS: each zip's name, size in bytes and SHA-256, the versions and
   the commit they were built from. scripts/package.mjs writes this file when the deploy packages
   the downloads; the page reads it as a script, never with fetch. The committed copy is the
   placeholder, and says "built at deploy" wherever a number goes: put it back with
   `node scripts/package.mjs --placeholder` before a commit. test-site.mjs checks either form. */
window.CIA_DOWNLOADS = {
  "built": false,
  "commit": "built at deploy",
  "version": {
    "package": "built at deploy",
    "manifest": "built at deploy"
  },
  "extensionName": "built at deploy",
  "files": {
    "extension": {
      "name": "cat-intelligence-agency-extension.zip",
      "bytes": "built at deploy",
      "sha256": "built at deploy"
    },
    "cats": {
      "name": "cia-cats.zip",
      "bytes": "built at deploy",
      "sha256": "built at deploy"
    }
  }
};
