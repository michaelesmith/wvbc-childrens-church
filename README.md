# WVBC Children's Church

Lesson plans for children's church.

- `plans.csv` — schedule of dates, topics, scripture, and leaders
- `template.md` — lesson plan template
- `lessons/YYYY-MM-DD.md` — one lesson per scheduled date

## Generating PDFs

```sh
npm install
node generate.js                         # every lesson -> output/
node generate.js 2026-10-18 2026-10-11   # only these (dates or file paths)
node generate.js --regen                 # overwrite existing PDFs (or --regenerate)
```

Only lessons with `draft: false` are generated; drafts are listed as errors
after the other PDFs are built. Existing PDFs are skipped unless `--regen` is
passed.

Each lesson is scaled to fill two Letter pages, with the date and leaders in the
page header and a small last week / next week recap above the title (taken from
the previous and next lessons in `lessons/`).
