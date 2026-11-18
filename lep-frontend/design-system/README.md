# Design system sources

These two files are copied verbatim from the *Learn English with Play* design-system artifact
(see `DESIGN-HANDOFF.md` in the project):

* `tokens.json` — colour (light and dark), type, spacing, radius, shadow and size tokens.
* `art.json` — the 61 line icons, the 6 brand-coloured icons and Pip's 6 poses, extracted from
  `components/bundle.js` (`var ART = …`).

Nothing in `src/` reads them directly. `npm run gen:design` turns them into
`src/design/tokens.generated.ts` and `src/design/art.generated.ts`; those generated files are
the only places in the app where a colour literal may appear (lint-enforced, DECISIONS §7.7).
When the design system changes, replace these files and re-run the generator.
