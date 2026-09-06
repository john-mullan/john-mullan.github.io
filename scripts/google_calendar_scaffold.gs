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
const BULK_EDITOR_PROPERTY = "WEBSITE_BULK_EDITOR_ID";
const BULK_SHEET_NAME = "Events";
const BULK_HEADERS = [
  "Apply", "Start", "End", "Title", "Ensemble", "Details URL", "Venue",
  "Event key", "Status"
];
const ENSEMBLE_CHOICES = [
  "Ars Populi",
  "Basilica of the National Shrine Choir",
  "D.C. Singer Collective",
  "The Thirteen",
  "Washington National Cathedral Choir"
];

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
  refreshBulkEditorIfPresent_();
}

function scheduledSweep() {
  addMissingScaffolds_();
  const result = applyBulkEdits_(false);
  if (result.updated) refreshBulkEditorIfPresent_();
}

function runNow() {
  const updated = addMissingScaffolds_();
  refreshBulkEditorIfPresent_();
  console.log("Added metadata fields to " + updated + " event(s).");
}

/**
 * Creates (or refreshes) a spreadsheet for editing Website event metadata.
 * Run this once, then open the URL printed in the execution log.
 */
function createBulkEditor() {
  getWebsiteCalendar_();

  const properties = PropertiesService.getScriptProperties();
  let spreadsheet = null;
  const savedId = properties.getProperty(BULK_EDITOR_PROPERTY);
  if (savedId) {
    try {
      spreadsheet = SpreadsheetApp.openById(savedId);
    } catch (error) {
      console.warn("The saved bulk editor could not be opened; creating a new one.");
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create("Website Calendar Bulk Editor");
    properties.setProperty(BULK_EDITOR_PROPERTY, spreadsheet.getId());
  }

  const count = refreshBulkEditor_(spreadsheet);
  console.log("Bulk editor ready with " + count + " event(s): " + spreadsheet.getUrl());
  return spreadsheet.getUrl();
}

/** Refreshes the existing editor while preserving edits that are not applied yet. */
function refreshBulkEditor() {
  const spreadsheet = getBulkEditor_(true);
  const count = refreshBulkEditor_(spreadsheet);
  console.log("Refreshed " + count + " event(s): " + spreadsheet.getUrl());
}

/** Immediately writes every checked row back to Google Calendar. */
function applyBulkEdits() {
  const result = applyBulkEdits_(true);
  console.log(
    "Updated " + result.updated + " event(s); " + result.missing +
    " row(s) could not be matched."
  );
}

function addMissingScaffolds_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 0;

  try {
    const calendar = getWebsiteCalendar_();
    const [start, end] = eventWindow_();

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

function getWebsiteCalendar_() {
  const calendarId = PropertiesService.getScriptProperties()
    .getProperty("WEBSITE_CALENDAR_ID");
  if (!calendarId) throw new Error("Run setUp() once before using this function.");

  const calendar = CalendarApp.getOwnedCalendarById(calendarId);
  if (!calendar) throw new Error("The configured Website calendar is unavailable.");
  return calendar;
}

function eventWindow_() {
  const start = new Date(HISTORY_START_YEAR, 0, 1);
  const end = new Date();
  end.setDate(end.getDate() + LOOK_AHEAD_DAYS);
  return [start, end];
}

function getBulkEditor_(required) {
  const id = PropertiesService.getScriptProperties().getProperty(BULK_EDITOR_PROPERTY);
  if (!id) {
    if (required) throw new Error("Run createBulkEditor() first.");
    return null;
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (error) {
    if (required) throw new Error("The bulk editor spreadsheet is unavailable.");
    return null;
  }
}

function refreshBulkEditorIfPresent_() {
  const spreadsheet = getBulkEditor_(false);
  if (!spreadsheet) return;
  try {
    refreshBulkEditor_(spreadsheet);
  } catch (error) {
    console.error("Could not refresh the bulk editor: " + error.message);
  }
}

function refreshBulkEditor_(spreadsheet) {
  const calendar = getWebsiteCalendar_();
  const [start, end] = eventWindow_();
  const sheet = getOrCreateEventsSheet_(spreadsheet);
  const preserved = readEditorRows_(sheet);

  const rows = calendar.getEvents(start, end)
    .filter(event => isPublishable_(event))
    .map(event => {
      const key = eventKey_(event);
      const saved = preserved[key];
      const metadata = readWebsiteMetadata_(event.getDescription() || "");
      const allDay = event.isAllDayEvent();
      const eventStart = event.getStartTime();
      const rawEnd = event.getEndTime();
      const displayedEnd = allDay
        ? new Date(rawEnd.getTime() - 24 * 60 * 60 * 1000)
        : rawEnd;
      const sameDay = eventStart.toDateString() === displayedEnd.toDateString();

      return {
        start: eventStart,
        row: [
          saved ? saved.apply : false,
          eventStart,
          sameDay ? "" : displayedEnd,
          event.getTitle(),
          saved ? saved.ensemble : metadata.ensemble,
          saved ? saved.details : metadata.details,
          event.getLocation() || "",
          key,
          saved ? saved.status : ""
        ]
      };
    })
    .sort((a, b) => b.start.getTime() - a.start.getTime())
    .map(entry => entry.row);

  sheet.clear();
  sheet.getRange(1, 1, 1, BULK_HEADERS.length).setValues([BULK_HEADERS]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, BULK_HEADERS.length).setValues(rows);
    sheet.getRange(2, 1, rows.length, 1).insertCheckboxes();
    sheet.getRange(2, 2, rows.length, 2).setNumberFormat("mmm d, yyyy h:mm am/pm");
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(ENSEMBLE_CHOICES, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 5, rows.length, 1).setDataValidation(rule);
  }

  formatBulkEditor_(sheet, rows.length);
  return rows.length;
}

function getOrCreateEventsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(BULK_SHEET_NAME);
  if (sheet) return sheet;

  const sheets = spreadsheet.getSheets();
  if (sheets.length === 1 && sheets[0].getName() === "Sheet1") {
    sheet = sheets[0];
    sheet.setName(BULK_SHEET_NAME);
    return sheet;
  }
  return spreadsheet.insertSheet(BULK_SHEET_NAME);
}

function readEditorRows_(sheet) {
  if (sheet.getLastRow() < 2 || sheet.getLastColumn() < BULK_HEADERS.length) return {};
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BULK_HEADERS.length)
    .getValues();
  const preserved = {};
  rows.forEach(row => {
    const key = String(row[7] || "");
    if (!key) return;
    preserved[key] = {
      apply: row[0] === true,
      ensemble: String(row[4] || ""),
      details: String(row[5] || ""),
      status: String(row[8] || "")
    };
  });
  return preserved;
}

function formatBulkEditor_(sheet, rowCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, BULK_HEADERS.length)
    .setBackground("#722f37")
    .setFontColor("#f5efe3")
    .setFontWeight("bold");
  if (rowCount) {
    sheet.getRange(2, 2, rowCount, 3).setBackground("#eee9df");
    sheet.getRange(2, 7, rowCount, 1).setBackground("#eee9df");
  }
  sheet.setColumnWidth(1, 70);
  sheet.setColumnWidth(2, 165);
  sheet.setColumnWidth(3, 165);
  sheet.setColumnWidth(4, 280);
  sheet.setColumnWidth(5, 245);
  sheet.setColumnWidth(6, 330);
  sheet.setColumnWidth(7, 260);
  sheet.setColumnWidth(9, 165);
  sheet.hideColumns(8);
  sheet.getRange("A1").setNote(
    "Edit Ensemble and Details URL, then check Apply. The five-minute sweep " +
    "writes checked rows to Google Calendar; applyBulkEdits() runs it immediately."
  );
}

function applyBulkEdits_(required) {
  const spreadsheet = getBulkEditor_(required);
  if (!spreadsheet) return {updated: 0, missing: 0};
  const sheet = spreadsheet.getSheetByName(BULK_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return {updated: 0, missing: 0};

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {updated: 0, missing: 0};

  try {
    const calendar = getWebsiteCalendar_();
    const [start, end] = eventWindow_();
    const events = {};
    calendar.getEvents(start, end).forEach(event => {
      events[eventKey_(event)] = event;
    });

    const rowCount = sheet.getLastRow() - 1;
    const rows = sheet.getRange(2, 1, rowCount, BULK_HEADERS.length).getValues();
    let updated = 0;
    let missing = 0;

    rows.forEach((row, index) => {
      if (row[0] !== true) return;
      const event = events[String(row[7] || "")];
      const sheetRow = index + 2;
      if (!event) {
        sheet.getRange(sheetRow, 1).setValue(false);
        sheet.getRange(sheetRow, 9).setValue("Event not found");
        missing += 1;
        return;
      }

      const ensemble = String(row[4] || "").trim();
      const details = String(row[5] || "").trim();
      event.setDescription(updateWebsiteMetadata_(
        event.getDescription() || "", ensemble, details
      ));
      sheet.getRange(sheetRow, 1).setValue(false);
      sheet.getRange(sheetRow, 9).setValue(
        "Updated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, h:mm a")
      );
      updated += 1;
    });

    return {updated: updated, missing: missing};
  } finally {
    lock.releaseLock();
  }
}

function eventKey_(event) {
  return event.getId() + "|" + event.getStartTime().getTime();
}

function isPublishable_(event) {
  const title = event.getTitle();
  const description = event.getDescription() || "";
  return !/not\s+confirmed|tentative|\bhold\b|\?/i.test(title) &&
    !/^\s*(skip|private)\s*$/im.test(description);
}

function readWebsiteMetadata_(description) {
  const result = {ensemble: "", details: ""};
  description.split(/\r?\n/).forEach(line => {
    let match = line.match(/^\s*ensemble\s*:\s*(.*)$/i);
    if (match) result.ensemble = match[1].trim();
    match = line.match(/^\s*(details|tickets|url)\s*:\s*(.*)$/i);
    if (match) result.details = match[2].trim();
  });
  return result;
}

function updateWebsiteMetadata_(description, ensemble, details) {
  const kept = description.split(/\r?\n/).filter(line => {
    if (line.trim() === WEBSITE_MARKER) return false;
    return !/^\s*(ensemble|details|tickets|url)\s*:/i.test(line);
  });
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();

  const block = [
    WEBSITE_MARKER,
    "ensemble: " + ensemble,
    "details: " + details
  ].join("\n");
  return kept.length ? kept.join("\n") + "\n\n" + block : block;
}
