# Public content migration

From this folder run `npm ci`, then `node index.mjs`, then `node finish.mjs`.

Only public unauthenticated fetches are used. There are no WordPress writes or production mutations. The browser snapshot established source navigation; REST collection pagination, the public sitemap index, public HTML links and referenced CSS/media provide discovery.

Outputs: `../../data/site.json`, public raw HTML evidence under `../../data/source-html`, original URL status inventory, source styles, failure inventory, `../../public/media`, and `../../MIGRATION_REPORT.md`.

The root package/app are intentionally untouched. The sole parser dependency is isolated here. `finish.mjs` flattens visual builder wrappers into semantic content and includes configured background images, canonical aliases, and outbound booking iframe URLs in the link inventory. Raw evidence is never executable page content.
