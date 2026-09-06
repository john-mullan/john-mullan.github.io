/**
 * Adds the website metadata scaffold to events on the owned Google Calendar
 * named "Website". Run setUp() once; its installable trigger handles later
 * event creations and edits.
 */
const CALENDAR_NAME = "Website";
const WEBSITE_MARKER = "--- Website ---";
const HISTORY_START_YEAR = 2000;
const LOOK_AHEAD_DAYS = 1095;
const SWEEP_INTERVAL_MINUTES = 5;

function setUp() {
  const matches = CalendarApp.getOwnedCalendarsByName(CALENDAR_NAME);
  if (matches.length !== 1) {
    throw new Error(
      "Expected exactly one owned calendar named \"" + CALENDAR_NAME +
      "\"; found " + matches.length + "."
    );
  }

  const calendarId = matches[0].getId();
  PropertiesService.getScriptProperties().setProperty("WEBSITE_CALENDAR_ID", calendarId);

  ScriptApp.getProjectTriggers()
    .filter(trigger => ["calendarChanged", "scheduledSweep"].includes(
      trigger.getHandlerFunction()
    ))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("calendarChanged")
    .forUserCalendar(calendarId)
    .onEventUpdated()
    .create();

  ScriptApp.newTrigger("scheduledSweep")
    .timeBased()
    .everyMinutes(SWEEP_INTERVAL_MINUTES)
    .create();

  const updated = addMissingScaffolds_();
  console.log("Setup complete. Added metadata fields to " + updated + " event(s).");
}

function calendarChanged() {
  addMissingScaffolds_();
}

function scheduledSweep() {
  addMissingScaffolds_();
}

function runNow() {
  const updated = addMissingScaffolds_();
  console.log("Added metadata fields to " + updated + " event(s).");
}

function addMissingScaffolds_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 0;

  try {
    const calendarId = PropertiesService.getScriptProperties()
      .getProperty("WEBSITE_CALENDAR_ID");
    if (!calendarId) throw new Error("Run setUp() once before using the trigger.");

    const calendar = CalendarApp.getOwnedCalendarById(calendarId);
    if (!calendar) throw new Error("The configured Website calendar is unavailable.");

    const start = new Date(HISTORY_START_YEAR, 0, 1);
    const end = new Date();
    end.setDate(end.getDate() + LOOK_AHEAD_DAYS);

    let updated = 0;
    calendar.getEvents(start, end).forEach(event => {
      const title = event.getTitle();
      const description = event.getDescription() || "";

      if (/not\s+confirmed|tentative|\bhold\b|\?/i.test(title)) return;
      if (/^\s*(skip|private)\s*$/im.test(description)) return;

      const missing = [];
      if (!/^\s*ensemble\s*:/im.test(description)) missing.push("ensemble:");
      if (!/^\s*(details|tickets|url)\s*:/im.test(description)) missing.push("details:");
      if (!missing.length) return;

      const prefix = description.trimEnd();
      const block = [WEBSITE_MARKER].concat(missing).join("\n");
      event.setDescription(prefix ? prefix + "\n\n" + block : block);
      updated += 1;
    });

    return updated;
  } finally {
    lock.releaseLock();
  }
}
