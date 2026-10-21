---
name: qwen-antv-infographic
description: Make a phone-readable relationship infographic (parts, groups, links with branches, feedback loops and shared inputs) using AntV Infographic. Trigger for technical systems, processes, algorithms, protocols, or concise explanatory graphics.
---
# Qwen AntV Infographic
You write CONTENT only. The script picks the layout, sizes, colors, arrow routing and label positions, tries several layouts itself, then checks clipping, overlaps and phone text size.

1. Copy `templates/content.json` to `<out-dir>/content.json`; replace the values, keep the keys.
   - `parts`: 5–12 distinct components, states or steps. Every component the topic names is its own part (two sets stay two parts). `label` <= 32 chars; `detail` <= 69 chars of short words saying what THAT part does, decides or holds: not its label again, not another part's job.
   - `group`: 2–5 names (subsystem, role, phase), each shared by several parts; shown as colors plus a legend.
   - `links`: every real relationship (flow, signal, control). Include the topic's feedback loops (link back to an earlier part), branches (one part to 2+ parts) and shared inputs (one part feeding 2+). `label`: a verb or condition, at most 18 chars; label every link whose meaning is not obvious. A straight chain is rejected.
   - `takeaway`: one sentence; shown as its own highlighted line.
2. Run `scripts/make.sh <out-dir>/content.json <out-dir>` from this skill directory. Never write DSL, HTML, coordinates, sizes or layout code.
3. If `ok` is false, apply every hint in `errors` to the content file and rerun until `ok` is true. Fix errors by rewording only: never merge or delete a part, a link or a link label to make an error go away.
4. Open the PNG once: check each fact and that every arrow points the right way; fix wrong facts in the content and rerun.

| Error says | Fix |
|---|---|
| does not fit its box | Reword that label/detail shorter; keep the part. |
| link label ... overlaps | Reword that link label in 1–3 shorter words; keep the link and its label. |
| title/subtitle line is wider than the diagram | Reword the subtitle shorter. |
| straight chain | Add the real loop, branch or shared input. |
| renderer failed / dependencies missing | Rerun once; if it repeats, report the error. |
