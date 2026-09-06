# johnwmullan — personal website

Single-page site for John W. Mullan, tenor: biography, recordings, and performance
schedule, in the same visual language as the performance resume.

## What's here

```
index.html      the whole site (styles and scripts inline)
events.json     generated schedule data
ensembles.json  reusable ensemble-name → website mapping
audio/          recordings (m4a, remuxed with faststart for streaming)
img/            headshot
resume.pdf      downloadable performance resume
scripts/        ics_to_events.py — regenerates events.json from Google Calendar
.github/        nightly workflow that runs the script and commits changes
```

## Updating the schedule

Three ways, from most to least automatic:

1. **Google Calendar sync (once configured).** The workflow in
   `.github/workflows/update-schedule.yml` runs nightly, reads the public ICS
   feed of the dedicated **Website** calendar (repository secret
   `WEBSITE_ICS_URL`), rewrites `events.json`, and commits if anything
   changed. Copy a gig onto the Website calendar (open the event → ⋮ →
   *Copy to Website*) and the site follows by the next morning. Run it
   immediately anytime from the repo's **Actions** tab → *Update schedule
   from Google Calendar* → *Run workflow*.

   Past events already in `events.json` are preserved even when they drop
   off the calendar feed, so performance history accumulates automatically —
   only future events need curating.

   Calendar entry conventions (each line optional, in the event description):

   ```
   title: Evensong with The Thirteen     ← public title, if the entry name is shorthand
   ensemble: The Thirteen
   tickets: https://example.com/tickets
   venue: Washington National Cathedral  ← overrides the location field
   ```

   Multi-day Calendar events are generated with an `endDate` and displayed as
   a date range without a time, such as `Oct 4–6, 2026`. Single-day timed
   events continue to show their start time.

   `scripts/google_calendar_scaffold.gs` installs a Google Apps Script trigger
   that automatically adds blank `ensemble:` and `details:` lines to new or
   edited events on the Website calendar, including historical events back to
   2000. A five-minute sweep provides a fallback when Google's calendar-change
   notification is delayed. Ensemble websites are filled from `ensembles.json`;
   `ensembleUrl:` remains available as a per-event override.

   To edit many events at once, select `createBulkEditor` in Apps Script and
   click **Run**. Open the Google Sheet URL printed in the execution log. Edit
   the **Ensemble** and **Details URL** columns and check **Apply** for each row
   to publish. The five-minute sweep writes checked rows back to Calendar, or
   select `applyBulkEdits` and click **Run** for an immediate update. Calendar
   dates, titles, and locations are shown as shaded reference columns; continue
   editing those fields in Google Calendar. New Calendar events are added to
   the sheet automatically, and `refreshBulkEditor` is available for a manual
   refresh.

   Entries named with "not confirmed", "tentative", "hold", or "?" are skipped,
   as is any entry with a lone line "skip" or "private" in its description.

2. **Edit `events.json` by hand** — including from your phone via GitHub's web
   editor. Each event looks like:

   ```json
   { "date": "2026-12-12", "time": "7:30 pm", "title": "Holiday Concert",
     "ensemble": "Ars Populi", "ensembleUrl": "https://…", 
     "venue": "Cathedral of the Sacred Heart, Richmond", "url": "https://…tickets" }
   ```

   Only `date`, `title`, `ensemble`, and `venue` are required. Events dated in
   the past move to "Past performances" automatically — never delete them.

3. **Ask Claude Code** to add or change events, recordings, or bio text.

## Updating everything else

- **Recordings:** drop an `.m4a` in `audio/` (run
  `ffmpeg -i in.m4a -c copy -movflags +faststart audio/out.m4a` so it streams
  well) and copy one of the three player blocks in `index.html`.
- **Resume:** overwrite `resume.pdf`.
- **Headshot:** overwrite `img/headshot.png` (square, ~480 px).

## Previewing locally

```
python -m http.server 8765 --directory .
```

then open http://localhost:8765. (Opening index.html directly from disk won't
load the schedule — browsers block `fetch` on `file://` pages.)
