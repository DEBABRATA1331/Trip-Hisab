/**
 * =========================================================================
 * TRIP HISAB - GOOGLE APPS SCRIPT DATABASE CONNECTOR
 * =========================================================================
 * 
 * INSTRUCTIONS TO CONNECT YOUR GOOGLE SHEET:
 * 1. Open Google Sheets (https://sheets.new) and create a new blank spreadsheet.
 * 2. Name your spreadsheet (e.g. "Goa Trip 2026 Hisab").
 * 3. In the top menu, click: Extensions -> Apps Script.
 * 4. Delete any code in the editor, and paste ALL of this code into Code.gs.
 * 5. Click the "Save" icon (Floppy disk).
 * 6. Click the blue "Deploy" button (top right) -> Select "New deployment".
 * 7. Click the gear icon next to "Select type" -> choose "Web app".
 * 8. Set:
 *    - Description: Trip Hisab Sync
 *    - Execute as: "Me" (your email)
 *    - Who has access: "Anyone" (allows your web app to push/pull data securely)
 * 9. Click "Deploy" -> "Authorize Access" (Grant permissions with your Google account).
 * 10. Copy the "Web app URL" (starts with https://script.google.com/macros/s/...)
 * 11. Paste that URL into the Trip Hisab web app under Settings -> Google Sheet URL!
 * 
 * That's it! Every expense, split, kitty adjustment, and note will automatically
 * sync to and update your Google Sheet in real-time with formatted tabs!
 */

function doGet(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var metaSheet = ss.getSheetByName("_DATA_STORE_");
    
    if (!metaSheet) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "empty",
        message: "No data synced yet. Push from Trip Hisab to initialize."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var rawJson = metaSheet.getRange(1, 1).getValue();
    if (!rawJson) {
      return ContentService.createTextOutput(JSON.stringify({ status: "empty" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(rawJson)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 30 sec lock to prevent race conditions from 6 people
    
    var payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      payload = JSON.parse(e.parameter.data);
    }
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Store Raw JSON Backup in hidden/internal sheet
    var storeSheet = ss.getSheetByName("_DATA_STORE_");
    if (!storeSheet) {
      storeSheet = ss.insertSheet("_DATA_STORE_");
      storeSheet.hideSheet();
    }
    storeSheet.getRange(1, 1).setValue(JSON.stringify(payload));
    storeSheet.getRange(1, 2).setValue(new Date().toISOString());

    // 2. Render Human-Readable Google Sheet Tabs
    renderOverviewSheet(ss, payload);
    renderExpensesSheet(ss, payload);
    renderPersonalExpensesSheet(ss, payload);
    renderKittySheet(ss, payload);
    renderSettlementsSheet(ss, payload);
    renderNotesSheet(ss, payload);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      timestamp: new Date().toISOString(),
      message: "Data successfully synced and human-readable sheets formatted!"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------
// Sheet Formatting Helpers
// -------------------------------------------------------------
function setHeaderRow(sheet, headers) {
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#0F172A"); // Sleek Black
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function renderOverviewSheet(ss, data) {
  var sheet = ss.getSheetByName("Trip Summary") || ss.insertSheet("Trip Summary", 0);
  sheet.clear();

  var headers = [
    ["TRIP OVERVIEW: " + (data.tripName || "Trip Hisab"), "", "", ""],
    ["Last Synced", new Date().toLocaleString(), "", ""],
    ["Total Group Spend", (data.currency || "₹") + " " + (data.summary ? data.summary.totalGroupSpend : 0), "", ""],
    ["Total Kitty Balance", (data.currency || "₹") + " " + (data.kitty ? data.kitty.balance : 0), "", ""],
    ["", "", "", ""],
    ["Member Name", "Paid for Group", "Share of Group", "Net Balance (+ Get / - Owe)"]
  ];

  sheet.getRange(1, 1, headers.length, 4).setValues(headers);
  sheet.getRange(1, 1, 1, 4).merge().setBackground("#2563EB").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
  sheet.getRange(6, 1, 1, 4).setBackground("#0F172A").setFontColor("#FFFFFF").setFontWeight("bold");

  var rows = [];
  if (data.members && data.members.length > 0) {
    var memberStats = (data.summary && data.summary.members) || {};
    data.members.forEach(function(m) {
      var stats = memberStats[m.id] || {};
      var paid = stats.paid !== undefined ? stats.paid : (stats.paidForGroup !== undefined ? stats.paidForGroup : 0);
      var share = stats.share !== undefined ? stats.share : (stats.shareOfGroup !== undefined ? stats.shareOfGroup : 0);
      var balance = stats.balance !== undefined ? stats.balance : (stats.netGroupBalance !== undefined ? stats.netGroupBalance : 0);
      rows.push([
        m.name,
        paid,
        share,
        balance
      ]);
    });
  }

  if (rows.length > 0) {
    sheet.getRange(7, 1, rows.length, 4).setValues(rows);
    // Format net balance column colors
    for (var i = 0; i < rows.length; i++) {
      var cell = sheet.getRange(7 + i, 4);
      var val = Number(rows[i][3]);
      if (val > 0) {
        cell.setFontColor("#15803D").setFontWeight("bold"); // Green
      } else if (val < 0) {
        cell.setFontColor("#DC2626").setFontWeight("bold"); // Red
      }
    }
  }

  sheet.autoResizeColumns(1, 4);
}

function renderExpensesSheet(ss, data) {
  var sheet = ss.getSheetByName("Group Expenses") || ss.insertSheet("Group Expenses", 1);
  var headers = ["Date", "Description", "Category", "Amount (" + (data.currency || "₹") + ")", "Paid By", "Split Between", "Per Person Share"];
  setHeaderRow(sheet, headers);

  var rows = [];
  var expenses = (data.expenses || []).filter(function(e) { return !e.isPersonal; });
  var memberMap = {};
  (data.members || []).forEach(function(m) { memberMap[m.id] = m.name; });

  expenses.forEach(function(e) {
    var payerName = e.payerId === "KITTY" ? "Group Kitty" : (memberMap[e.payerId] || e.payerName || "Unknown");
    var splitNames = (e.splitWith || []).map(function(id) { return memberMap[id] || id; }).join(", ");
    var perPerson = e.splitWith && e.splitWith.length ? (e.amount / e.splitWith.length).toFixed(2) : 0;
    
    rows.push([
      e.date || "",
      e.title || "Expense",
      e.category || "General",
      Number(e.amount) || 0,
      payerName,
      splitNames,
      perPerson
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function renderPersonalExpensesSheet(ss, data) {
  var sheet = ss.getSheetByName("Personal Expenses") || ss.insertSheet("Personal Expenses", 2);
  var headers = ["Date", "Person", "Description", "Category", "Amount (" + (data.currency || "₹") + ")", "Notes"];
  setHeaderRow(sheet, headers);

  var rows = [];
  var expenses = (data.expenses || []).filter(function(e) { return e.isPersonal; });
  var memberMap = {};
  (data.members || []).forEach(function(m) { memberMap[m.id] = m.name; });

  expenses.forEach(function(e) {
    rows.push([
      e.date || "",
      memberMap[e.payerId] || "Unknown",
      e.title || "Personal Expense",
      e.category || "Personal",
      Number(e.amount) || 0,
      e.notes || ""
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function renderKittySheet(ss, data) {
  var sheet = ss.getSheetByName("Group Kitty (Pool)") || ss.insertSheet("Group Kitty (Pool)", 3);
  var headers = ["Date", "Type (+ In / - Out)", "Amount (" + (data.currency || "₹") + ")", "By / For", "Note", "Balance After"];
  setHeaderRow(sheet, headers);

  var rows = [];
  var logs = (data.kitty && data.kitty.history) || [];

  logs.forEach(function(l) {
    rows.push([
      l.date || "",
      l.type || "",
      Number(l.amount) || 0,
      l.member || "Group",
      l.note || "",
      Number(l.balanceAfter) || 0
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function renderSettlementsSheet(ss, data) {
  var sheet = ss.getSheetByName("Settlement Guide") || ss.insertSheet("Settlement Guide", 4);
  var headers = ["Who Pays", "Who Receives", "Amount (" + (data.currency || "₹") + ")", "Status"];
  setHeaderRow(sheet, headers);

  var rows = [];
  var settlements = (data.settlements || []);
  var memberMap = {};
  (data.members || []).forEach(function(m) { memberMap[m.id] = m.name; });

  settlements.forEach(function(s) {
    rows.push([
      memberMap[s.from] || s.fromName || s.from,
      memberMap[s.to] || s.toName || s.to,
      Number(s.amount) || 0,
      s.settled ? "SETTLED" : "PENDING"
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function renderNotesSheet(ss, data) {
  var sheet = ss.getSheetByName("Notes & Contacts") || ss.insertSheet("Notes & Contacts", 5);
  var headers = ["Type", "Title / Name", "Details / Number", "Updated At"];
  setHeaderRow(sheet, headers);

  var rows = [];
  (data.notes || []).forEach(function(n) {
    rows.push([
      n.type || "Note",
      n.title || "",
      n.content || "",
      n.updatedAt || ""
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}
