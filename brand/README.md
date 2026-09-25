# Cat Intelligence Agency — brand kit

The agents are **pixel kittens on a 2D floor**. The agency itself is **3D**. Every character,
scene, texture and the 3D building were made with Higgsfield, with the Director kitten as the
style reference for the others. Type was set over the art afterwards, so it is spelled exactly.
The first, non-pixel portrait set is in git history (commit 035de87).

There are seven cats. **CoinMarketCat**, the agentic trading cat, is an orange tabby pixel
kitten in a purple hoodie, holding a phone with a green chart and waving. **Snipurr**, the
sniper lane inside it, keeps CoinMarketCat's old art: the mint-green kitten in a black suit
with the sniper-scope eyepiece, and the old sniper desk on the work floor.

The words are in [COPY.md](COPY.md): X profile, launch thread, agent dossiers, investigation
house rules, the pump.fun description, and the site copy.

## Where each file goes

| File | Size | Use |
|---|---|---|
| `logo/cia-token-1000.png` | 1000×1000 | The $CIA image on pump.fun: **Crying Cat, sobbing over a case file stamped RUGGED** (wallets crop it round; it is circle-safe) |
| `logo/cia-avatar-400.png` | 400×400 | X profile photo, the same Crying Cat (circle-safe) |
| `banner/x-header-1500x500.jpg` | 1500×500 | X header: the seven kittens in a row, with the title clear of them and of the profile photo's overlap, lower left |
| `banner/og-1200x630.jpg` | 1200×630 | Link previews: the site's `og:image`, and the image to attach to launch posts. The seven in a row, each agent's beat listed beside them |
| `banner/site-hero-2400x1029.jpg`, `-1200x514.jpg` | | The seven-kitten roster scene; the left third is open sky for a title |
| `logo/cia-wordmark-1600x400.png` | 1600×400 | Horizontal lockup: the coin's Crying Cat and the name, on ink |
| `logo/favicon-32.png`, `favicon-64.png`, `apple-touch-180.png` | | Site icons |
| `sprites/<cat>.png` | about 145×207 | **The game sprites**: each kitten on a true 4 px grid, transparent, trimmed. Draw them with `image-rendering: pixelated` (or `NearestFilter` in three.js) at any whole multiple. `coinmarketcat.png` is 175×209 (it waves); `snipurr.png` is the old CoinMarketCat, 146×207 |
| `agents/<cat>-avatar-400.png` | 400×400 | Each kitten standing on the pixel floor, as a profile picture |
| `agents/<cat>-1024.png` | 1024×1024 | Each kitten as generated, transparent, for posts and reaction images. `snipurr-1024.png` and `snipurr-avatar-400.png` are the old CoinMarketCat pair |
| `3d/agency-hq.glb` | 1.4 MB | The agency headquarters, a textured 3D model (about 11,000 vertices, one 1024 JPEG texture), unit-sized and centred |
| `floor/workfloor.png` | 2688×1520 | **The work floor**: the agency's office in isometric pixel art, with seven desks and each kitten at its station (the Director by the world-map screen, Crying Cat behind a pile of RUGGED files, Grumpy Cat, CashCat by the window, Popcat at the radar, Snipurr at the sniper screen, and CoinMarketCat at the new desk in the front-left corner, where the sofa and rug were). `workfloor-alt.png` is the older six-desk take |
| `floor/tear-sheet.png`, `floor/case-file.png`, `floor/enter-portal.png` | 1024×1024, transparent | Floor sprites: a 4-frame falling-tear strip (left to right), the case-file icon for posted cases, and the glowing ENTER portal marker for the building |
| `floor/screen-<cat>.png`, `floor/case-board.png` | 4:3 / 16:9 | Each cat's monitor screen and the cork case board, for the stations on the site. `screen-coinmarketcat.png` is the agent console (an equity line, a decision log with ticks, risk meters); `screen-snipurr.png` is the old sniper screen |
| `source/` | | The coin logo at 2160 px (and the two earlier versions: the Director, and Crying Cat with a thumbs up), the seven-kitten roster scene (left to right: Popcat, Crying Cat, Grumpy Cat, the Director, CashCat, Snipurr, CoinMarketCat) and the earlier meme roster, the Director portrait, an alternate pose of CoinMarketCat (`pixel-coinmarketcat-alt-1024.png`), the seamless pixel floor tile, and the building concept image, as generated |
| `hq/hero/hq-trading-room-2688x1152.png` | 2688×1152 | **Agency HQ's hero** (the /hq/ page): the live trading room, cats in suits at terminals, a curved wall of screens with an Agent of the Month podium, a gold vault door and the night skyline. The left third is calmer, for the title. Web copies: `site/assets/hq/hq-trading-room-1600.webp` and `-2688.webp` |
| `hq/hero/treasury-vault-2688x1520.png` | 2688×1520 | **The Transparency page's hero** (/investors/): a glass-walled treasury vault, coin shelves, a transparent cabinet, a cat accountant with a ledger chained to a checklist screen, and a furnace melting coins (the burn). Web copies: `site/assets/hq/treasury-vault-1600.webp` and `-2688.webp` |
| `hq/ranks/<rank>.png` | about 100 to 230 px | The five HQ ranks' art, on the 4 px grid, drawn pixelated: `recruit` (bronze, one star), `field` (silver, two stars, a mint ribbon), `special` (gold, a cat in sunglasses, three stars), `senior` (platinum and blue, four stars), `director` (violet and gold, a crowned cat, five stars). The site's copies in `site/assets/hq/ranks/` are byte for byte these |
| `hq/skins/<skin>.png` | about 150 to 180 × 211 | The agent skins: the same grey tabby agent kitten in an outfit, on the 4 px grid. One per rank (`recruit` a hoodie and lanyard, `field` a trench coat, fedora and magnifier, `special` a black suit, sunglasses and earpiece, `senior` a navy suit, gold tie and holo pass, `director` a suit, violet cape and crown), each rank's by default; `nightops` and `holder` (a gold bomber jacket with a $CIA coin) are cosmetic perk skins. Copied byte for byte to `site/assets/hq/skins/` |
| `hq/source/` | 1024×1024 | Each rank's and each skin's original, as generated |
| `../icons/cia-32/128/512.png` | | The Cat Intelligence Agency extension's icons: the coin's Crying Cat, cropped from `logo/cia-token-1000.png` into rounded squares |
| `../icons/coinmarketcat-32/128/512.png` | | CoinMarketCat's face, in its hoodie: the site's CoinMarketCat icons (the extension's own icons before it carried all five cats) |

The cats: `director` (the mascot; the coin's face is Crying Cat), `coinmarketcat` (the agentic trader, software; its
sprite is its tab's picture in the extension), `snipurr` (the sniper lane beside CoinMarketCat, software), `crying-cat` (ruggers),
`grumpy-cat` (fake hype), `cashcat` (the auto-launcher bot, being built), `popcat` (the cat-coin callout bot, being built).

## Palette

| | Hex | Used for |
|---|---|---|
| Ink | `#0b0716` | Every background |
| Mint | `#14f195` | "INTELLIGENCE", Snipurr, the floor's grout, the Director's ring |
| Hoodie purple | `#8b5cf6` | CoinMarketCat |
| Violet | `#9945ff` | Glows, the Director |
| Gold | `#f5c542` | $CIA, CashCat |
| Tear blue | `#5ab8ff` | Crying Cat |
| Burnt orange | `#e8742c` | Grumpy Cat |
| Hot pink | `#ff4fd8` | Popcat |

## Type

Anton (titles), JetBrains Mono (labels), Archivo (body). All three are from Google Fonts under
the SIL Open Font License. A pixel face such as Press Start 2P (also OFL) suits small labels
next to the sprites.
