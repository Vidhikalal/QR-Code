/**
 * Passline — Form + Sheet setup (README "Connecting a Google Form"). Lives next to Code.gs in the
 * same Apps Script project; it uses SHEET_NAME and headerMap_ from Code.gs.
 *
 * setupTestForm: run ONCE from a NEW, EMPTY Google Sheet:
 *   1. sheets.new → Extensions → Apps Script
 *   2. Paste apps-script/Code.gs from the repo into Code.gs, then add a file "Setup" with THIS code
 *   3. Fill in CONFIG below → select setupTestForm → Run → approve the permissions prompt
 *   4. View → Logs (or the Execution log) shows the form link to open
 *
 * Question titles below must match HEADERS in Code.gs exactly; don't rename them.
 */
const CONFIG = {
  // Your stable tunnel URL (README) or your deployed app, + /api/ingest/sheet
  ENDPOINT: 'https://YOUR-TUNNEL.trycloudflare.com/api/ingest/sheet',
  EVENT_SLUG: 'test-2026',
  INGEST_SECRET: 'PASTE_SHEET_INGEST_SECRET_FROM_.env.local',
};

function requireConfig_() {
  if (CONFIG.ENDPOINT.includes('YOUR-TUNNEL') || CONFIG.INGEST_SECRET.length < 32) {
    throw new Error('Fill in CONFIG first (ENDPOINT and INGEST_SECRET).');
  }
}

function setupTestForm() {
  requireConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheets().some(s => s.getFormUrl())) {
    throw new Error('This spreadsheet already has a linked form. Run setup from a new, empty Sheet.');
  }

  // 1. The form.
  const form = FormApp.create('Passline Test — Event Application');
  form.setDescription('Test form for the Passline check-in app. Fake names and emails are fine.')
      .setCollectEmail(false)          // "Email Address" is a normal question instead (matches Code.gs)
      .setAllowResponseEdits(false);
  form.addTextItem().setTitle('First Name').setRequired(true);
  form.addTextItem().setTitle('Last Name');
  form.addTextItem().setTitle('Email Address').setRequired(true)
      .setValidation(FormApp.createTextValidation().setHelpText('Enter a valid email.').requireTextIsEmail().build());
  form.addParagraphTextItem().setTitle('Dietary Restrictions');
  form.addTextItem().setTitle('LinkedIn URL').setHelpText('Optional, e.g. https://www.linkedin.com/in/your-name')
      .setValidation(FormApp.createTextValidation().setHelpText('Enter a full URL.').requireTextIsUrl().build());
  // Profile questions (2026-10-13). The titles must match HEADERS in Code.gs; answers seed the profile.
  form.addTextItem().setTitle('What are you good at?').setHelpText('A few skills, separated by commas (up to 5), e.g. React, design, pitching');
  form.addCheckboxItem().setTitle('What are you looking for?')
      .setChoiceValues(['A team', 'A mentor', 'An internship', 'A job', 'Networking']);
  form.addParagraphTextItem().setTitle('Accessibility or health needs')
      .setHelpText('Anything organizers should know. Only organizers see this unless you choose to share it on your profile.');

  // 2. Send responses to this spreadsheet and wait for the response tab to appear.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  const sheet = waitForResponseSheet_(ss.getId(), 9); // Timestamp + 8 questions
  if (sheet.getName() !== SHEET_NAME) sheet.setName(SHEET_NAME); // SHEET_NAME comes from Code.gs

  // 3. The three organizer columns, with a dropdown on Status (blank = pending).
  const lastCol = sheet.getLastColumn();
  sheet.getRange(1, lastCol + 1, 1, 3).setValues([['Applicant ID', 'Status', 'Sync Status']]);
  const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Accepted', 'Waitlisted', 'Rejected', 'Withdrawn'], true)
      .setAllowInvalid(false)
      .build();
  sheet.getRange(2, lastCol + 2, sheet.getMaxRows() - 1, 1).setDataValidation(statusRule);
  sheet.setFrozenRows(1);

  // 4. Script properties read by Code.gs.
  PropertiesService.getScriptProperties().setProperties({
    ENDPOINT: CONFIG.ENDPOINT,
    EVENT_SLUG: CONFIG.EVENT_SLUG,
    INGEST_SECRET: CONFIG.INGEST_SECRET,
  });

  // 5. Installable triggers (replacing any earlier copies).
  installTriggers_(ss);

  Logger.log('Open this to submit test applications: ' + form.getPublishedUrl());
  Logger.log('Edit the form: ' + form.getEditUrl());
  Logger.log('Responses land on the "' + SHEET_NAME + '" tab of this Sheet.');
}

/** After ANY CONFIG edit (new tunnel URL, event slug or secret): saves all three settings Code.gs reads. */
function updateEndpoint() {
  requireConfig_();
  PropertiesService.getScriptProperties().setProperties({
    ENDPOINT: CONFIG.ENDPOINT, EVENT_SLUG: CONFIG.EVENT_SLUG, INGEST_SECRET: CONFIG.INGEST_SECRET,
  });
  Logger.log('Now using ' + CONFIG.ENDPOINT + ' for event ' + CONFIG.EVENT_SLUG + '.');
}

/** Shows the settings Code.gs will actually use (never the secret). */
function showEndpoint() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('ENDPOINT: ' + (props.getProperty('ENDPOINT') || '(not set)'));
  Logger.log('EVENT_SLUG: ' + (props.getProperty('EVENT_SLUG') || '(not set)'));
}

/**
 * For an EXISTING form that already has responses: after adding the Applicant ID / Status / Sync Status
 * columns and Code.gs, run this once. Rows submitted before the script existed have no Applicant ID and
 * would come back INVALID:external_id when accepted. Only fills blank cells, so it is safe to re-run.
 */
function backfillApplicantIds() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No tab named "' + SHEET_NAME + '". Rename the response tab or change SHEET_NAME in Code.gs.');
  const cols = headerMap_(sheet);
  const n = sheet.getLastRow() - 1;
  if (n < 1) return;
  const range = sheet.getRange(2, cols.id, n, 1);
  range.setValues(range.getValues().map(([v]) => [v || Utilities.getUuid()]));
  Logger.log('Checked ' + n + ' rows; blank Applicant IDs filled.');
}

/** For an EXISTING Sheet: set script properties from CONFIG and install both triggers (no new form). */
function connectExistingSheet() {
  requireConfig_();
  PropertiesService.getScriptProperties().setProperties({
    ENDPOINT: CONFIG.ENDPOINT,
    EVENT_SLUG: CONFIG.EVENT_SLUG,
    INGEST_SECRET: CONFIG.INGEST_SECRET,
  });
  installTriggers_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Connected to ' + CONFIG.ENDPOINT + ' for event ' + CONFIG.EVENT_SLUG + '.');
}

function installTriggers_(ss) {
  const handlers = ['onFormSubmitInstalled', 'onEditInstalled'];
  ScriptApp.getProjectTriggers()
      .filter(t => handlers.indexOf(t.getHandlerFunction()) !== -1)
      .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitInstalled').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();
}

function waitForResponseSheet_(spreadsheetId, minCols) {
  for (let i = 0; i < 20; i++) {
    SpreadsheetApp.flush();
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets().find(s => s.getFormUrl());
    if (sheet && sheet.getLastColumn() >= minCols) return sheet;
    Utilities.sleep(1000);
  }
  throw new Error('The linked response tab did not appear. Delete this Sheet and re-run in a fresh one.');
}
