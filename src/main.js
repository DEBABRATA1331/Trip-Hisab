// =========================================================================
// TRIP HISAB - MAIN CONTROLLER & APPLICATION ENTRY POINT (NO EMOJIS, NO FAKE DATA)
// =========================================================================

import { stateManager } from './state.js';
import {
  renderApp,
  showToast,
  setActiveTab,
  setExpenseFilter,
  setSearchQuery,
  openExpenseModal,
  openMemberDetailModal,
  openModal,
  closeModal,
  setExpenseMode,
  toggleSplitMember,
  selectAllSplitMembers,
  clearAllSplitMembers,
  getSelectedSplitMembers,
  updateSplitPreview,
  isPersonalMode
} from './ui.js';
import { calculateTripSummary, generateGroupSummaryReportText } from './settlement.js';
import { pushToGoogleSheet, exportToCSV, downloadBackupJSON } from './sheets-sync.js';

// Preload Google Apps Script template code for easy copy-paste
const APPS_SCRIPT_CODE = `/**
 * TRIP HISAB - GOOGLE APPS SCRIPT WEB APP
 * Paste this in your Google Sheet (Extensions -> Apps Script -> Code.gs)
 * Click Deploy -> New Deployment -> Web App (Execute as: Me, Access: Anyone)
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("_DATA_STORE_");
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({status: "empty"})).setMimeType(ContentService.MimeType.JSON);
  return ContentService.createTextOutput(sheet.getRange(1, 1).getValue()).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var payload = JSON.parse(e.postData ? e.postData.contents : e.parameter.data);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Store backup
    var store = ss.getSheetByName("_DATA_STORE_") || ss.insertSheet("_DATA_STORE_");
    store.getRange(1, 1).setValue(JSON.stringify(payload));
    
    // Format Overview Tab
    var summary = ss.getSheetByName("Trip Overview") || ss.insertSheet("Trip Overview", 0);
    summary.clear();
    summary.getRange("A1:D1").setValues([["TRIP: " + (payload.tripName || "Hisab"), "", "", ""]]).setBackground("#2563EB").setFontColor("#FFF").setFontWeight("bold");
    summary.getRange("A2:B2").setValues([["Total Group Spend", (payload.currency || "₹") + " " + (payload.summary ? payload.summary.totalGroupSpend : 0)]]);
    summary.getRange("A3:B3").setValues([["Group Kitty Pool", (payload.currency || "₹") + " " + (payload.kitty ? payload.kitty.balance : 0)]]);
    
    // Member balances table
    summary.getRange("A5:D5").setValues([["Member Name", "Paid for Group", "Share of Group", "Net Balance"]]).setBackground("#0F172A").setFontColor("#FFF");
    var mRows = [];
    (payload.members || []).forEach(function(m) {
      var s = (payload.summary && payload.summary.members && payload.summary.members[m.id]) || {paid:0, share:0, balance:0};
      mRows.push([m.name, s.paid || 0, s.share || 0, s.balance || 0]);
    });
    if (mRows.length) summary.getRange(6, 1, mRows.length, 4).setValues(mRows);
    
    // Format Group Expenses Tab
    var expSheet = ss.getSheetByName("Group Expenses") || ss.insertSheet("Group Expenses", 1);
    expSheet.clear();
    expSheet.getRange("A1:E1").setValues([["Date", "Title", "Category", "Amount", "Paid By"]]).setBackground("#0F172A").setFontColor("#FFF");
    var eRows = [];
    (payload.expenses || []).filter(function(x){return !x.isPersonal;}).forEach(function(x) {
      eRows.push([x.date, x.title, x.category, Number(x.amount)||0, x.payerId==="KITTY"?"Group Kitty":(x.payerId||"")]);
    });
    if (eRows.length) expSheet.getRange(2, 1, eRows.length, 5).setValues(eRows);

    return ContentService.createTextOutput(JSON.stringify({status:"success", time:new Date().toISOString()})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error", error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}`;

// Clean legacy seeded data if present from earlier tests
function cleanLegacyFakeData() {
  try {
    localStorage.removeItem('TRIP_HISAB_DATA_V1');
    const current = localStorage.getItem('TRIP_HISAB_DATA_V2');
    if (current) {
      const parsed = JSON.parse(current);
      // If expenses have fake seed ids, clear them
      if (parsed.expenses && parsed.expenses.some(e => e.id && e.id.startsWith('exp_init_'))) {
        parsed.expenses = [];
        parsed.kitty = { balance: 0, history: [] };
        parsed.notes = [];
        parsed.settlements = [];
        localStorage.setItem('TRIP_HISAB_DATA_V2', JSON.stringify(parsed));
        stateManager.state.expenses = [];
        stateManager.state.kitty = { balance: 0, history: [] };
        stateManager.state.notes = [];
        stateManager.state.settlements = [];
      }
    }
  } catch (err) {
    console.warn('Clean legacy data error', err);
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // 1. Navigation Tabs
  document.querySelectorAll('.nav-tab-btn, .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) setActiveTab(tab);
    });
  });

  // 2. Undo / Redo Buttons
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  btnUndo.addEventListener('click', () => {
    const action = stateManager.undo();
    if (action) {
      showToast(`Undone: ${action}`);
    }
  });

  btnRedo.addEventListener('click', () => {
    const action = stateManager.redo();
    if (action) {
      showToast(`Redone: ${action}`);
    }
  });

  // Global Keyboard Shortcuts (Ctrl+Z / Ctrl+Y / Cmd+Z / Cmd+Shift+Z)
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      return;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const action = stateManager.undo();
      if (action) showToast(`Undone: ${action}`);
    } else if (
      (isCtrlOrCmd && e.key.toLowerCase() === 'y') ||
      (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'z')
    ) {
      e.preventDefault();
      const action = stateManager.redo();
      if (action) showToast(`Redone: ${action}`);
    }
  });

  // 3. Add Expense Buttons
  document.getElementById('btn-quick-add-header').addEventListener('click', () => openExpenseModal());
  document.getElementById('fab-add-expense').addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-dash-add-expense').addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-add-expense-tab').addEventListener('click', () => openExpenseModal());

  // 4. Expense Type Toggle (Group vs Personal)
  document.getElementById('btn-toggle-group-exp').addEventListener('click', () => setExpenseMode(false));
  document.getElementById('btn-toggle-personal-exp').addEventListener('click', () => setExpenseMode(true));

  // 5. Expense Form Submission
  const formExpense = document.getElementById('form-expense');
  formExpense.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('input-expense-id').value;
    const title = document.getElementById('input-exp-title').value.trim();
    const amount = parseFloat(document.getElementById('input-exp-amount').value);
    const category = document.getElementById('select-exp-category').value;
    const payerId = document.getElementById('select-exp-payer').value;
    const date = document.getElementById('input-exp-date').value;
    const notes = document.getElementById('input-exp-notes').value.trim();
    const isPersonal = isPersonalMode();

    if (!amount || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    const splitWith = isPersonal ? [] : getSelectedSplitMembers();
    if (!isPersonal && splitWith.length === 0) {
      alert('Please select at least 1 person to split with');
      return;
    }

    if (id) {
      // Edit
      stateManager.updateExpense(id, {
        title,
        amount,
        category,
        payerId,
        date,
        notes,
        isPersonal,
        splitWith
      });
      showToast(`Updated "${title}"`, 'Undo', () => stateManager.undo());
    } else {
      // Add
      stateManager.addExpense({
        title,
        amount,
        category,
        payerId,
        date,
        notes,
        isPersonal,
        splitWith
      });
      showToast(`Added "${title}"`, 'Undo', () => stateManager.undo());
    }

    closeModal('modal-expense');
    formExpense.reset();
  });

  // Amount input change updates live split preview
  document.getElementById('input-exp-amount').addEventListener('input', updateSplitPreview);

  // Split Checkbox delegates
  document.getElementById('split-members-checkboxes').addEventListener('change', (e) => {
    if (e.target.classList.contains('cb-split-member')) {
      toggleSplitMember(e.target.value, e.target.checked);
    }
  });
  document.getElementById('btn-split-select-all').addEventListener('click', selectAllSplitMembers);
  document.getElementById('btn-split-clear-all').addEventListener('click', clearAllSplitMembers);

  // 6. Expense List Filters & Search
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setExpenseFilter(btn.dataset.filter));
  });

  const searchInput = document.getElementById('expense-search-input');
  searchInput.addEventListener('input', (e) => setSearchQuery(e.target.value));

  // Edit / Delete Expense Actions (Delegation)
  document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit-exp');
    if (editBtn) {
      const id = editBtn.dataset.id;
      const expense = stateManager.state.expenses.find(x => x.id === id);
      if (expense) openExpenseModal(expense);
      return;
    }

    const deleteBtn = e.target.closest('.btn-delete-exp');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const expense = stateManager.state.expenses.find(x => x.id === id);
      if (expense && confirm(`Delete "${expense.title}" (${stateManager.state.currency}${expense.amount})?`)) {
        stateManager.deleteExpense(id);
        showToast(`Deleted "${expense.title}"`, 'Undo', () => stateManager.undo());
      }
      return;
    }

    // View Member Report Card click
    const viewMemberBtn = e.target.closest('.btn-view-member-report, .member-report-card');
    if (viewMemberBtn) {
      const memberId = viewMemberBtn.dataset.id || viewMemberBtn.dataset.memberId;
      if (memberId) openMemberDetailModal(memberId);
      return;
    }

    // Quick Settle Button
    const quickSettleBtn = e.target.closest('.btn-quick-settle');
    if (quickSettleBtn) {
      openSettlementModal(quickSettleBtn.dataset.from, quickSettleBtn.dataset.to, quickSettleBtn.dataset.amount);
      return;
    }

    // Delete Settlement Button
    const deleteSettleBtn = e.target.closest('.btn-delete-settlement');
    if (deleteSettleBtn) {
      stateManager.deleteSettlement(deleteSettleBtn.dataset.id);
      showToast('Settlement deleted', 'Undo', () => stateManager.undo());
      return;
    }

    // Delete Note Button
    const deleteNoteBtn = e.target.closest('.btn-delete-note');
    if (deleteNoteBtn) {
      const id = deleteNoteBtn.dataset.id;
      stateManager.deleteNote(id);
      showToast('Note deleted', 'Undo', () => stateManager.undo());
      return;
    }

    // Edit Note Button
    const editNoteBtn = e.target.closest('.btn-edit-note');
    if (editNoteBtn) {
      const id = editNoteBtn.dataset.id;
      const note = stateManager.state.notes.find(n => n.id === id);
      if (note) openNoteModal(note);
      return;
    }

    // Copy Note Content
    const copyNoteBtn = e.target.closest('.btn-copy-note');
    if (copyNoteBtn) {
      const content = copyNoteBtn.dataset.content;
      navigator.clipboard.writeText(content).then(() => {
        showToast('Copied to clipboard');
      });
      return;
    }

    // Close Modal via background click or close button
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }

    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
    }
  });

  // 7. Group Kitty Actions
  document.getElementById('btn-dash-kitty-deposit').addEventListener('click', () => openKittyActionModal('DEPOSIT'));
  document.getElementById('btn-kitty-add-deposit').addEventListener('click', () => openKittyActionModal('DEPOSIT'));
  document.getElementById('btn-kitty-withdraw').addEventListener('click', () => openKittyActionModal('WITHDRAW'));
  document.getElementById('btn-kitty-modify').addEventListener('click', () => openKittyActionModal('MODIFY'));

  const formKitty = document.getElementById('form-kitty-action');
  formKitty.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('kitty-action-type').value;
    const amount = parseFloat(document.getElementById('input-kitty-amount').value);
    const memberId = document.getElementById('select-kitty-member').value;
    const note = document.getElementById('input-kitty-note').value.trim();

    if (isNaN(amount) || (type !== 'MODIFY' && amount <= 0)) {
      alert('Please enter a valid amount');
      return;
    }

    if (type === 'DEPOSIT') {
      stateManager.addKittyDeposit({ amount, memberId, note });
      showToast(`Added to pool`, 'Undo', () => stateManager.undo());
    } else if (type === 'WITHDRAW') {
      stateManager.withdrawKitty({ amount, memberId, note });
      showToast(`Withdrawn from pool`, 'Undo', () => stateManager.undo());
    } else if (type === 'MODIFY') {
      stateManager.modifyKittyBalance({ newBalance: amount, reason: note });
      showToast(`Adjusted pool balance`, 'Undo', () => stateManager.undo());
    }

    closeModal('modal-kitty-action');
    formKitty.reset();
  });

  // 8. Settlement Modal & Actions
  document.getElementById('btn-dash-settle').addEventListener('click', () => openSettlementModal());
  document.getElementById('btn-record-settlement-split').addEventListener('click', () => openSettlementModal());

  const formSettlement = document.getElementById('form-settlement');
  formSettlement.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = document.getElementById('select-settle-from').value;
    const to = document.getElementById('select-settle-to').value;
    const amount = parseFloat(document.getElementById('input-settle-amount').value);
    const note = document.getElementById('input-settle-note').value.trim();

    if (!amount || amount <= 0) {
      alert('Please enter a valid settled amount');
      return;
    }
    if (from === to) {
      alert('Debtor and Creditor cannot be the same person');
      return;
    }

    stateManager.recordSettlement({ from, to, amount, note });
    showToast(`Settlement recorded`, 'Undo', () => stateManager.undo());
    closeModal('modal-settlement');
    formSettlement.reset();
  });

  // 9. Notes & Numbers Modal
  document.getElementById('btn-add-note').addEventListener('click', () => openNoteModal());

  const formNote = document.getElementById('form-note');
  formNote.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('input-note-id').value;
    const type = document.getElementById('select-note-type').value;
    const title = document.getElementById('input-note-title').value.trim();
    const content = document.getElementById('input-note-content').value.trim();

    if (id) {
      stateManager.updateNote(id, { type, title, content });
      showToast(`Note updated: "${title}"`, 'Undo', () => stateManager.undo());
    } else {
      stateManager.addNote({ type, title, content });
      showToast(`Note added: "${title}"`, 'Undo', () => stateManager.undo());
    }

    closeModal('modal-note');
    formNote.reset();
  });

  // 10. Summary Share
  const shareGroupHisab = () => {
    const summary = calculateTripSummary(stateManager.state);
    const text = generateGroupSummaryReportText(summary, stateManager.state.tripName);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };
  document.getElementById('btn-dash-share-summary').addEventListener('click', shareGroupHisab);
  document.getElementById('btn-share-all-whatsapp').addEventListener('click', shareGroupHisab);

  // 11. Quick Links in Dashboard to tabs
  document.getElementById('btn-open-splits-tab').addEventListener('click', () => setActiveTab('splits'));
  document.getElementById('btn-open-all-expenses').addEventListener('click', () => setActiveTab('expenses'));

  // 12. Trip Header & Settings & Member Management
  const goToManageMembers = () => {
    setActiveTab('settings');
    const target = document.getElementById('card-members-settings');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };
  document.getElementById('btn-edit-trip-header').addEventListener('click', () => setActiveTab('settings'));
  document.getElementById('header-sync-pill').addEventListener('click', () => setActiveTab('settings'));
  document.getElementById('header-members-count').addEventListener('click', goToManageMembers);
  document.getElementById('btn-header-manage-members').addEventListener('click', goToManageMembers);
  const btnOpenMembers = document.getElementById('btn-open-manage-members');
  if (btnOpenMembers) btnOpenMembers.addEventListener('click', goToManageMembers);

  document.getElementById('input-trip-name').addEventListener('change', (e) => {
    stateManager.updateTripInfo({ name: e.target.value });
    showToast('Trip name updated', 'Undo', () => stateManager.undo());
  });

  document.getElementById('select-currency').addEventListener('change', (e) => {
    stateManager.updateTripInfo({ currency: e.target.value });
    showToast(`Currency changed to ${e.target.value}`);
  });

  // Member Rename in Settings
  document.getElementById('settings-members-list').addEventListener('change', (e) => {
    if (e.target.classList.contains('input-member-rename')) {
      const id = e.target.dataset.id;
      const newName = e.target.value.trim();
      if (newName) {
        stateManager.updateMember(id, { name: newName });
        showToast(`Member renamed to ${newName}`, 'Undo', () => stateManager.undo());
      }
    }
  });

  // Member Remove in Settings
  document.getElementById('settings-members-list').addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.btn-remove-member');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      const member = stateManager.state.members.find(m => m.id === id);
      const name = member ? member.name : 'member';
      if (confirm(`Remove "${name}" from this trip?`)) {
        stateManager.removeMember(id);
        showToast(`Removed ${name}`, 'Undo', () => stateManager.undo());
      }
    }
  });

  // Member Add in Settings
  const handleAddMember = () => {
    const input = document.getElementById('input-new-member-name');
    const name = input.value.trim();
    if (name) {
      stateManager.addMember(name);
      input.value = '';
      showToast(`Added friend: ${name}`, 'Undo', () => stateManager.undo());
    } else {
      input.focus();
    }
  };
  document.getElementById('btn-add-member').addEventListener('click', handleAddMember);
  document.getElementById('input-new-member-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  });

  // 13. Google Sheets Integration
  document.getElementById('btn-save-sheet-url').addEventListener('click', () => {
    const url = document.getElementById('input-google-sheet-url').value.trim();
    stateManager.updateGoogleSheetUrl(url);
    if (url) {
      showToast('Saving and syncing with Google Sheet...');
      pushToGoogleSheet(stateManager.state, true).then(res => {
        if (res.success) {
          showToast('Connected and synced to Google Sheet');
        } else {
          showToast(`Sync issue: ${res.error || 'Check Web App URL'}`);
        }
      });
    } else {
      showToast('Google Sheet disconnected');
    }
  });

  document.getElementById('btn-manual-sync-now').addEventListener('click', () => {
    showToast('Syncing with Google Sheet...');
    pushToGoogleSheet(stateManager.state, true).then(res => {
      if (res.success) {
        showToast('Google Sheet is up to date');
      } else {
        showToast(`Sync error: ${res.error || 'Check URL'}`);
      }
    });
  });

  document.getElementById('btn-view-apps-script-guide').addEventListener('click', () => {
    document.getElementById('code-apps-script-box').value = APPS_SCRIPT_CODE;
    openModal('modal-apps-script-guide');
  });

  document.getElementById('btn-copy-apps-script').addEventListener('click', () => {
    navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
      showToast('Apps Script code copied to clipboard');
    });
  });

  // 14. Backup & CSV Export
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    exportToCSV(stateManager.state);
    showToast('Downloaded CSV report');
  });

  document.getElementById('btn-download-backup').addEventListener('click', () => {
    downloadBackupJSON(stateManager.state);
    showToast('Backup file saved');
  });

  document.getElementById('input-restore-backup').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const res = stateManager.importBackup(evt.target.result);
      if (res.success) {
        showToast('Trip data restored successfully');
      } else {
        alert(`Restore error: ${res.error}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

function openKittyActionModal(type) {
  const state = stateManager.state;
  document.getElementById('kitty-action-type').value = type;
  const title = document.getElementById('modal-kitty-title');
  const amountLabel = document.getElementById('label-kitty-amount');
  const memberGroup = document.getElementById('group-kitty-member');
  const memberSelect = document.getElementById('select-kitty-member');

  // Populate Member choices
  memberSelect.innerHTML = `<option value="ALL">All ${state.members.length} Friends (Equal contribution each)</option>`;
  state.members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    memberSelect.appendChild(opt);
  });

  if (type === 'DEPOSIT') {
    title.textContent = 'Add Money to Group Pool (Kitty)';
    amountLabel.innerHTML = `Deposit Amount (<span class="currency-label">${state.currency}</span>)`;
    memberGroup.style.display = 'block';
  } else if (type === 'WITHDRAW') {
    title.textContent = 'Withdraw Cash from Pool (Kitty)';
    amountLabel.innerHTML = `Withdraw Amount (<span class="currency-label">${state.currency}</span>)`;
    memberGroup.style.display = 'block';
  } else if (type === 'MODIFY') {
    title.textContent = 'Adjust Pool Balance Directly';
    amountLabel.innerHTML = `Set New Balance (<span class="currency-label">${state.currency}</span>)`;
    document.getElementById('input-kitty-amount').value = state.kitty.balance;
    memberGroup.style.display = 'none';
  }

  openModal('modal-kitty-action');
}

function openSettlementModal(fromId = '', toId = '', amount = '') {
  const state = stateManager.state;
  const fromSelect = document.getElementById('select-settle-from');
  const toSelect = document.getElementById('select-settle-to');

  fromSelect.innerHTML = '';
  toSelect.innerHTML = '';

  state.members.forEach(m => {
    const optFrom = document.createElement('option');
    optFrom.value = m.id;
    optFrom.textContent = m.name;
    fromSelect.appendChild(optFrom);

    const optTo = document.createElement('option');
    optTo.value = m.id;
    optTo.textContent = m.name;
    toSelect.appendChild(optTo);
  });

  if (fromId) fromSelect.value = fromId;
  if (toId) toSelect.value = toId;
  if (amount) document.getElementById('input-settle-amount').value = amount;

  openModal('modal-settlement');
}

function openNoteModal(noteToEdit = null) {
  const isEdit = !!noteToEdit;
  document.getElementById('modal-note-title').textContent = isEdit ? 'Edit Note / Number' : 'Add Note / Number';
  document.getElementById('input-note-id').value = isEdit ? noteToEdit.id : '';
  document.getElementById('select-note-type').value = isEdit ? noteToEdit.type : 'contact';
  document.getElementById('input-note-title').value = isEdit ? noteToEdit.title : '';
  document.getElementById('input-note-content').value = isEdit ? noteToEdit.content : '';

  openModal('modal-note');
}

// App Initialization
function init() {
  cleanLegacyFakeData();
  setupEventListeners();

  // Connect Google Sheet debounced auto-sync
  stateManager.onAutoSync = (s) => pushToGoogleSheet(s, false);

  // Re-render whenever state changes
  stateManager.subscribe(() => {
    renderApp();
  });

  // Initial render
  renderApp();
}

init();
