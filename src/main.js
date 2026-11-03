// =========================================================================
// TRIP HISAB - MAIN CONTROLLER & APPLICATION ENTRY POINT
// =========================================================================

import { getUser, signOut as supabaseSignOut } from './supabase.js';
import { stateManager } from './db-state.js';
import { mountAucklandSkylineCanvas } from './ascii-bg.js';
import {
  renderApp,
  renderRouteView,
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
import { pushToGoogleSheet, pullFromGoogleSheet, exportToCSV, downloadBackupJSON } from './sheets-sync.js';

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
    var store = ss.getSheetByName("_DATA_STORE_") || ss.insertSheet("_DATA_STORE_");
    store.getRange(1, 1).setValue(JSON.stringify(payload));
    var summary = ss.getSheetByName("Trip Overview") || ss.insertSheet("Trip Overview", 0);
    summary.clear();
    summary.getRange("A1:D1").setValues([["TRIP: " + (payload.tripName || "Hisab"), "", "", ""]]).setBackground("#0066FF").setFontColor("#FFF").setFontWeight("bold");
    summary.getRange("A2:B2").setValues([["Total Group Spend", (payload.currency || "₹") + " " + (payload.summary ? payload.summary.totalGroupSpend : 0)]]);
    summary.getRange("A3:B3").setValues([["Group Kitty Pool", (payload.currency || "₹") + " " + (payload.kitty ? payload.kitty.balance : 0)]]);
    return ContentService.createTextOutput(JSON.stringify({status:"success", time:new Date().toISOString()})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error", error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}`;

/**
 * Geocode a place query via OpenStreetMap Nominatim
 */
async function searchPlacesNominatim(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function setupEventListeners() {
  // 1. Navigation Tabs
  document.querySelectorAll('.nav-tab-btn, .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) setActiveTab(tab);
    });
  });

  // 2. Add Expense Buttons
  document.getElementById('btn-quick-add-header')?.addEventListener('click', () => openExpenseModal());
  document.getElementById('fab-add-expense')?.addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-dash-add-expense')?.addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-add-expense-tab')?.addEventListener('click', () => openExpenseModal());

  // 3. Expense Type Toggle (Group vs Personal)
  document.getElementById('btn-toggle-group-exp')?.addEventListener('click', () => setExpenseMode(false));
  document.getElementById('btn-toggle-personal-exp')?.addEventListener('click', () => setExpenseMode(true));

  // 4. Expense Form Submission
  const formExpense = document.getElementById('form-expense');
  formExpense?.addEventListener('submit', async (e) => {
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
      showToast('Please enter a valid amount');
      return;
    }

    const splitWith = isPersonal ? [] : getSelectedSplitMembers();
    if (!isPersonal && splitWith.length === 0) {
      showToast('Select at least 1 friend to split with');
      return;
    }

    closeModal('modal-expense');
    formExpense.reset();

    try {
      if (id) {
        await stateManager.updateExpense(id, { title, amount, category, payerId, date, notes, isPersonal, splitWith });
        showToast(`Updated "${title}"`);
      } else {
        await stateManager.addExpense({ title, amount, category, payerId, date, notes, isPersonal, splitWith });
        showToast(`Added "${title}"`);
      }
    } catch (err) {
      showToast('Could not save expense: ' + (err.message || ''));
    }
  });

  document.getElementById('input-exp-amount')?.addEventListener('input', updateSplitPreview);

  document.getElementById('split-members-checkboxes')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('cb-split-member')) {
      toggleSplitMember(e.target.value, e.target.checked);
    }
  });
  document.getElementById('btn-split-select-all')?.addEventListener('click', selectAllSplitMembers);
  document.getElementById('btn-split-clear-all')?.addEventListener('click', clearAllSplitMembers);

  // 5. Expense List Filters & Search
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setExpenseFilter(btn.dataset.filter));
  });

  document.getElementById('expense-search-input')?.addEventListener('input', (e) => setSearchQuery(e.target.value));

  // 6. Delegated Clicks (Expenses, Members, Settlements, Notes, Kitty, Stops)
  document.addEventListener('click', async (e) => {
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
        await stateManager.deleteExpense(id);
        showToast(`Deleted "${expense.title}"`);
      }
      return;
    }

    const viewMemberBtn = e.target.closest('.btn-view-member-report, .member-report-card');
    if (viewMemberBtn) {
      const memberId = viewMemberBtn.dataset.id || viewMemberBtn.dataset.memberId;
      if (memberId) openMemberDetailModal(memberId);
      return;
    }

    const quickSettleBtn = e.target.closest('.btn-quick-settle');
    if (quickSettleBtn) {
      openSettlementModal(quickSettleBtn.dataset.from, quickSettleBtn.dataset.to, quickSettleBtn.dataset.amount);
      return;
    }

    const deleteSettleBtn = e.target.closest('.btn-delete-settlement');
    if (deleteSettleBtn) {
      await stateManager.deleteSettlement(deleteSettleBtn.dataset.id);
      showToast('Settlement deleted');
      return;
    }

    const deleteNoteBtn = e.target.closest('.btn-delete-note');
    if (deleteNoteBtn) {
      await stateManager.deleteNote(deleteNoteBtn.dataset.id);
      showToast('Note deleted');
      return;
    }

    const editNoteBtn = e.target.closest('.btn-edit-note');
    if (editNoteBtn) {
      const note = stateManager.state.notes.find(n => n.id === editNoteBtn.dataset.id);
      if (note) openNoteModal(note);
      return;
    }

    const copyNoteBtn = e.target.closest('.btn-copy-note');
    if (copyNoteBtn) {
      navigator.clipboard.writeText(copyNoteBtn.dataset.content || '').then(() => {
        showToast('Copied to clipboard');
      });
      return;
    }

    const deleteKittyBtn = e.target.closest('.btn-delete-kitty');
    if (deleteKittyBtn) {
      const id = deleteKittyBtn.dataset.id;
      const item = (stateManager.state.kitty?.history || []).find(h => h.id === id);
      if (item && confirm(`Delete pool transaction "${item.note || item.type}"?`)) {
        await stateManager.deleteKittyTransaction(id);
        showToast('Pool entry deleted');
      }
      return;
    }

    const btnRemoveStop = e.target.closest('.btn-remove-stop');
    if (btnRemoveStop) {
      const stopId = btnRemoveStop.dataset.id;
      await stateManager.removeDestination(stopId);
      showToast('Stop removed from route');
      return;
    }

    const btnRenameMember = e.target.closest('.btn-rename-member');
    if (btnRenameMember) {
      document.getElementById('input-rename-member-id').value = btnRenameMember.dataset.id;
      document.getElementById('input-rename-member-name').value = btnRenameMember.dataset.name || '';
      openModal('modal-rename-member');
      setTimeout(() => document.getElementById('input-rename-member-name')?.focus(), 60);
      return;
    }

    const btnRemoveMember = e.target.closest('.btn-remove-member');
    if (btnRemoveMember) {
      const memberId = btnRemoveMember.dataset.id;
      const member = stateManager.state.members.find(m => m.id === memberId);
      if (confirm(`Remove "${member ? member.name : 'this traveler'}" from the trip?`)) {
        await stateManager.removeMember(memberId);
        showToast('Friend removed');
      }
      return;
    }

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
  document.getElementById('btn-dash-kitty-deposit')?.addEventListener('click', () => openKittyActionModal('DEPOSIT'));
  document.getElementById('btn-kitty-add-deposit')?.addEventListener('click', () => openKittyActionModal('DEPOSIT'));
  document.getElementById('btn-kitty-withdraw')?.addEventListener('click', () => openKittyActionModal('WITHDRAW'));
  document.getElementById('btn-kitty-modify')?.addEventListener('click', () => openKittyActionModal('MODIFY'));

  const formKitty = document.getElementById('form-kitty-action');
  formKitty?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('kitty-action-type').value;
    const amount = parseFloat(document.getElementById('input-kitty-amount').value);
    const memberId = document.getElementById('select-kitty-member').value;
    const note = document.getElementById('input-kitty-note').value.trim();
    const date = document.getElementById('input-kitty-date').value;

    if (isNaN(amount) || (type !== 'MODIFY' && amount <= 0)) {
      showToast('Please enter a valid amount');
      return;
    }

    closeModal('modal-kitty-action');
    formKitty.reset();

    if (type === 'DEPOSIT') {
      await stateManager.addKittyDeposit({ amount, memberId, note, date });
      showToast('Added money to Group Kitty');
    } else if (type === 'WITHDRAW') {
      await stateManager.withdrawKitty({ amount, memberId, note, date });
      showToast('Withdrawn cash from Kitty');
    } else if (type === 'MODIFY') {
      await stateManager.modifyKittyBalance({ newBalance: amount, reason: note, date });
      showToast('Kitty balance updated');
    }
  });

  // 8. Settlement Modal
  document.getElementById('btn-dash-settle')?.addEventListener('click', () => openSettlementModal());
  document.getElementById('btn-record-settlement-split')?.addEventListener('click', () => openSettlementModal());

  const formSettlement = document.getElementById('form-settlement');
  formSettlement?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const from = document.getElementById('select-settle-from').value;
    const to = document.getElementById('select-settle-to').value;
    const amount = parseFloat(document.getElementById('input-settle-amount').value);
    const note = document.getElementById('input-settle-note').value.trim();

    if (!amount || amount <= 0) {
      showToast('Enter a valid amount');
      return;
    }
    if (from === to) {
      showToast('Payer and receiver must be different');
      return;
    }

    closeModal('modal-settlement');
    formSettlement.reset();
    await stateManager.recordSettlement({ from, to, amount, note });
    showToast('Settlement recorded');
  });

  // 9. Notes Modal
  document.getElementById('btn-add-note')?.addEventListener('click', () => openNoteModal());

  const formNote = document.getElementById('form-note');
  formNote?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('input-note-id').value;
    const type = document.getElementById('select-note-type').value;
    const title = document.getElementById('input-note-title').value.trim();
    const content = document.getElementById('input-note-content').value.trim();

    closeModal('modal-note');
    formNote.reset();

    if (id) {
      await stateManager.updateNote(id, { type, title, content });
      showToast(`Note updated: "${title}"`);
    } else {
      await stateManager.addNote({ type, title, content });
      showToast(`Note saved: "${title}"`);
    }
  });

  // 10. Summary Share
  const shareGroupHisab = () => {
    const summary = calculateTripSummary(stateManager.state);
    const text = generateGroupSummaryReportText(summary, stateManager.state.tripName);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };
  document.getElementById('btn-dash-share-summary')?.addEventListener('click', shareGroupHisab);
  document.getElementById('btn-share-all-whatsapp')?.addEventListener('click', shareGroupHisab);

  document.getElementById('btn-open-splits-tab')?.addEventListener('click', () => setActiveTab('splits'));
  document.getElementById('btn-open-all-expenses')?.addEventListener('click', () => setActiveTab('expenses'));

  // 11. Settings & Friends Navigation
  const goToManageMembers = () => {
    setActiveTab('settings');
    document.getElementById('card-members-access-settings')?.scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('btn-edit-trip-header')?.addEventListener('click', () => setActiveTab('settings'));
  document.getElementById('header-sync-pill')?.addEventListener('click', () => setActiveTab('settings'));
  document.getElementById('header-members-count')?.addEventListener('click', goToManageMembers);
  document.getElementById('btn-header-manage-members')?.addEventListener('click', goToManageMembers);
  document.getElementById('btn-open-manage-members')?.addEventListener('click', goToManageMembers);

  document.getElementById('input-trip-name')?.addEventListener('change', async (e) => {
    await stateManager.updateTripInfo({ name: e.target.value });
    showToast('Trip name updated');
  });

  document.getElementById('select-currency')?.addEventListener('change', async (e) => {
    await stateManager.updateTripInfo({ currency: e.target.value });
    showToast(`Currency updated to ${e.target.value}`);
  });

  // Save Renamed Member
  document.getElementById('form-rename-member')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const memberId = document.getElementById('input-rename-member-id').value;
    const newName = document.getElementById('input-rename-member-name').value.trim();
    if (!newName) return;
    closeModal('modal-rename-member');
    try {
      await stateManager.renameMember(memberId, newName);
      showToast(`Renamed to ${newName}`);
    } catch (err) {
      showToast('Failed to rename: ' + (err.message || ''));
    }
  });

  // Add Friend in Settings
  document.getElementById('form-settings-add-placeholder')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('input-settings-friend-name');
    const name = (input?.value || '').trim();
    if (!name) return;
    input.value = '';
    try {
      await stateManager.addMember(name);
      showToast(`Friend added: ${name}`);
    } catch (err) {
      showToast('Could not add friend: ' + (err.message || ''));
    }
  });

  // 12. Google Sheets Mirror & CSV Backup
  document.getElementById('btn-save-sheet-url')?.addEventListener('click', () => {
    const url = document.getElementById('input-google-sheet-url').value.trim();
    stateManager.updateGoogleSheetUrl(url);
    if (url) {
      showToast('Syncing with Google Sheet...');
      pushToGoogleSheet(stateManager.state, true).then(res => {
        showToast(res.success ? 'Synced to Google Sheet!' : `Sheet notice: ${res.error || 'Check URL'}`);
      });
    } else {
      showToast('Google Sheet URL cleared');
    }
  });

  document.getElementById('btn-manual-sync-now')?.addEventListener('click', () => {
    showToast('Pushing to Google Sheet...');
    pushToGoogleSheet(stateManager.state, true).then(res => {
      showToast(res.success ? 'Google Sheet updated!' : `Sync error: ${res.error || 'Add URL first'}`);
    });
  });

  document.getElementById('btn-view-apps-script-guide')?.addEventListener('click', () => {
    document.getElementById('code-apps-script-box').value = APPS_SCRIPT_CODE;
    openModal('modal-apps-script-guide');
  });

  document.getElementById('btn-copy-apps-script')?.addEventListener('click', () => {
    navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
      showToast('Apps Script copied!');
    });
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    exportToCSV(stateManager.state);
    showToast('CSV exported');
  });

  document.getElementById('btn-download-backup')?.addEventListener('click', () => {
    downloadBackupJSON(stateManager.state);
    showToast('JSON backup saved');
  });

  // 13. Logout
  document.getElementById('btn-header-logout')?.addEventListener('click', async () => {
    if (confirm('Log out from Upmark Curve?')) {
      stateManager.destroy?.();
      await supabaseSignOut();
      window.location.href = './login.html';
    }
  });

  // 14. Share Trip Invite Links & Codes (Clean Gen-Z Professional Copy)
  document.getElementById('btn-header-share-trip')?.addEventListener('click', openShareTripModal);
  document.getElementById('btn-settings-share-link')?.addEventListener('click', openShareTripModal);

  document.getElementById('btn-copy-share-link')?.addEventListener('click', () => {
    const link = document.getElementById('input-share-link').value;
    navigator.clipboard.writeText(link).then(() => showToast('Trip link copied!'));
  });

  document.getElementById('btn-copy-code-box')?.addEventListener('click', () => {
    const code = stateManager.state.inviteCode || '';
    if (code) {
      navigator.clipboard.writeText(code).then(() => showToast(`Invite code ${code} copied!`));
    }
  });

  const buildCleanInviteMessage = () => {
    const state = stateManager.state;
    const link = `${window.location.origin}/index.html?trip=${state.tripId || ''}`;
    return `Join our trip "${state.tripName}" on Upmark Curve (The Trip Hisab)!\n\n` +
      `Track group bills, split expenses, chat live, and plan our route together:\n` +
      `Direct Link: ${link}\n` +
      `Invite Code: ${state.inviteCode || ''}`;
  };

  document.getElementById('btn-copy-full-invite')?.addEventListener('click', () => {
    navigator.clipboard.writeText(buildCleanInviteMessage()).then(() => {
      showToast('Invite message copied!');
    });
  });

  document.getElementById('btn-share-whatsapp-invite')?.addEventListener('click', () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(buildCleanInviteMessage())}`, '_blank');
  });

  document.getElementById('btn-dash-copy-link')?.addEventListener('click', () => {
    const link = document.getElementById('dash-share-url-input')?.value || `${window.location.origin}/index.html?trip=${stateManager.state.tripId || ''}`;
    navigator.clipboard.writeText(link).then(() => showToast('Invite link copied!'));
  });

  document.getElementById('btn-dash-share-whatsapp')?.addEventListener('click', () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(buildCleanInviteMessage())}`, '_blank');
  });

  // 15. Trip Live Chat
  document.getElementById('form-chat-send')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('input-chat-message');
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    try {
      await stateManager.sendMessage(text);
    } catch (err) {
      showToast('Failed to send message: ' + (err.message || ''));
    }
  });

  // 16. Route & Multi-Destination Map
  document.getElementById('btn-open-add-stop')?.addEventListener('click', () => {
    document.getElementById('form-add-stop')?.reset();
    const resBox = document.getElementById('modal-place-search-results');
    if (resBox) resBox.style.display = 'none';
    openModal('modal-add-stop');
    setTimeout(() => document.getElementById('input-stop-name')?.focus(), 60);
  });

  // Preset city chips inside modal
  document.querySelectorAll('#preset-cities-chips .chip-preset').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('input-stop-name').value = chip.dataset.name;
      document.getElementById('input-stop-lat').value = chip.dataset.lat;
      document.getElementById('input-stop-lng').value = chip.dataset.lng;
    });
  });

  // Live Geocoding Search inside Add Stop Modal
  document.getElementById('btn-search-place-modal')?.addEventListener('click', async () => {
    const q = document.getElementById('input-stop-name')?.value.trim();
    const resultsBox = document.getElementById('modal-place-search-results');
    if (!q || !resultsBox) return;

    resultsBox.style.display = 'block';
    resultsBox.innerHTML = `<div class="route-search-item">Searching OpenStreetMap for "${q}"...</div>`;
    const places = await searchPlacesNominatim(q);

    if (places.length === 0) {
      resultsBox.innerHTML = `<div class="route-search-item">No exact coordinates found. Try adding city or state name.</div>`;
      return;
    }

    // Auto-fill the top match immediately
    document.getElementById('input-stop-lat').value = parseFloat(places[0].lat).toFixed(5);
    document.getElementById('input-stop-lng').value = parseFloat(places[0].lon).toFixed(5);

    resultsBox.innerHTML = places.map(p => {
      const shortName = (p.display_name || '').split(',').slice(0, 2).join(', ');
      return `
        <div class="route-search-item" data-name="${shortName.replace(/"/g, '&quot;')}" data-lat="${parseFloat(p.lat).toFixed(5)}" data-lng="${parseFloat(p.lon).toFixed(5)}">
          <strong>${shortName}</strong>
          <span>${p.display_name}</span>
        </div>
      `;
    }).join('');

    resultsBox.querySelectorAll('.route-search-item').forEach(item => {
      item.addEventListener('click', () => {
        if (!item.dataset.lat) return;
        document.getElementById('input-stop-name').value = item.dataset.name;
        document.getElementById('input-stop-lat').value = item.dataset.lat;
        document.getElementById('input-stop-lng').value = item.dataset.lng;
        resultsBox.style.display = 'none';
      });
    });
  });

  // Inline Route Search Bar right above the Map
  const handleInlinePlaceSearch = async () => {
    const input = document.getElementById('inline-route-search-input');
    const resultsBox = document.getElementById('inline-route-search-results');
    const q = (input?.value || '').trim();
    if (!q || !resultsBox) return;

    resultsBox.style.display = 'block';
    resultsBox.innerHTML = `<div class="route-search-item">Searching "${q}"...</div>`;
    const places = await searchPlacesNominatim(q);

    if (places.length === 0) {
      resultsBox.innerHTML = `<div class="route-search-item">No places found for "${q}". Try another landmark or city.</div>`;
      return;
    }

    resultsBox.innerHTML = places.map(p => {
      const shortName = (p.display_name || '').split(',').slice(0, 2).join(', ');
      return `
        <div class="route-search-item" data-name="${shortName.replace(/"/g, '&quot;')}" data-lat="${parseFloat(p.lat).toFixed(5)}" data-lng="${parseFloat(p.lon).toFixed(5)}">
          <div>
            <strong>+ Add Stop: ${shortName}</strong>
            <span>${p.display_name}</span>
          </div>
        </div>
      `;
    }).join('');

    resultsBox.querySelectorAll('.route-search-item').forEach(item => {
      item.addEventListener('click', async () => {
        if (!item.dataset.lat) return;
        const name = item.dataset.name;
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        resultsBox.style.display = 'none';
        input.value = '';
        showToast(`Adding ${name} to route...`);
        await stateManager.addDestination({ name, lat, lng, stayNotes: '' });
        showToast(`Added stop: ${name}`);
      });
    });
  };

  document.getElementById('btn-inline-route-search')?.addEventListener('click', handleInlinePlaceSearch);
  document.getElementById('inline-route-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInlinePlaceSearch();
    }
  });

  // Submit Add Stop Modal (auto-geocodes if lat/lng are empty!)
  document.getElementById('form-add-stop')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-stop-name').value.trim();
    let lat = parseFloat(document.getElementById('input-stop-lat').value) || 0;
    let lng = parseFloat(document.getElementById('input-stop-lng').value) || 0;
    const stayNotes = document.getElementById('input-stop-notes').value.trim();

    closeModal('modal-add-stop');
    showToast(`Adding ${name}...`);

    // Auto-geocode if user typed a city name without coordinates
    if (!lat && !lng && name) {
      const matches = await searchPlacesNominatim(name);
      if (matches.length > 0) {
        lat = parseFloat(matches[0].lat) || 0;
        lng = parseFloat(matches[0].lon) || 0;
      }
    }

    try {
      await stateManager.addDestination({ name, lat, lng, stayNotes });
      showToast(`Stop added: ${name}`);
    } catch (err) {
      showToast('Failed to add stop: ' + (err.message || ''));
    }
  });

  // Open Full Multi-Destination Route in Google Maps
  document.getElementById('btn-open-google-maps-route')?.addEventListener('click', () => {
    const stops = stateManager.state.destinations || [];
    if (stops.length === 0) {
      showToast('Add at least 1 destination stop first!');
      return;
    }
    const waypoints = stops.map(s => {
      if (parseFloat(s.lat) && parseFloat(s.lng)) {
        return `${s.lat},${s.lng}`;
      }
      return encodeURIComponent(s.name);
    });
    const url = `https://www.google.com/maps/dir/${waypoints.join('/')}`;
    window.open(url, '_blank');
  });

  document.getElementById('route-transit-speed')?.addEventListener('change', () => {
    renderRouteView(stateManager.state);
  });
  document.getElementById('route-departure-time')?.addEventListener('change', () => {
    renderRouteView(stateManager.state);
  });
}

export function getActiveUser() {
  if (stateManager.currentMember) {
    return {
      id: stateManager.currentMember.id,
      name: stateManager.currentMember.name || 'Traveler',
      avatar: stateManager.currentMember.avatar || 'T',
      role: stateManager.currentMember.role || 'member',
      color: stateManager.currentMember.color || '#0066FF'
    };
  }
  if (stateManager.currentUser) {
    const name = stateManager.currentUser.user_metadata?.display_name || stateManager.currentUser.email?.split('@')[0] || 'Traveler';
    return {
      id: stateManager.currentUser.id,
      name,
      avatar: name.charAt(0).toUpperCase(),
      role: 'admin',
      color: '#0066FF'
    };
  }
  return null;
}

function updateHeaderUserBadge(user) {
  const badge = document.getElementById('header-user-badge');
  const avatarEl = document.getElementById('header-user-avatar');
  const nameEl = document.getElementById('header-user-name');
  if (!badge) return;

  if (user) {
    badge.style.display = 'inline-flex';
    if (nameEl) nameEl.textContent = user.name;
    if (avatarEl) {
      avatarEl.textContent = user.avatar || user.name.charAt(0).toUpperCase();
      if (user.color) avatarEl.style.background = user.color;
    }
  } else {
    badge.style.display = 'none';
  }
}

function openShareTripModal() {
  const state = stateManager.state;
  const tripId = state.tripId || new URLSearchParams(window.location.search).get('trip') || '';
  const inviteCode = state.inviteCode || '';
  const shareUrl = `${window.location.origin}/index.html?trip=${tripId}`;

  const linkInput = document.getElementById('input-share-link');
  if (linkInput) linkInput.value = shareUrl;

  const pinEl = document.getElementById('share-modal-pin');
  if (pinEl) pinEl.textContent = inviteCode || '------';

  openModal('modal-share-trip');
}

function openKittyActionModal(type) {
  const state = stateManager.state;
  document.getElementById('kitty-action-type').value = type;
  document.getElementById('kitty-edit-id').value = '';
  const title = document.getElementById('modal-kitty-title');
  const amountLabel = document.getElementById('label-kitty-amount');
  const memberGroup = document.getElementById('group-kitty-member');
  const memberSelect = document.getElementById('select-kitty-member');
  const dateInput = document.getElementById('input-kitty-date');
  const noteInput = document.getElementById('input-kitty-note');
  const amountInput = document.getElementById('input-kitty-amount');
  const hintEl = document.getElementById('hint-kitty-amount');

  memberSelect.innerHTML = `<option value="ALL">All ${state.members.length} Friends (Equal contribution each)</option>`;
  state.members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    memberSelect.appendChild(opt);
  });
  const poolOpt = document.createElement('option');
  poolOpt.value = 'POOL';
  poolOpt.textContent = 'Common Pool / Cash';
  memberSelect.appendChild(poolOpt);

  const updateHint = () => {
    const selectedMember = memberSelect.value;
    const amt = parseFloat(amountInput.value) || 0;
    if (type === 'DEPOSIT' && selectedMember === 'ALL' && state.members.length > 0) {
      hintEl.textContent = `Entering ${state.currency}${amt || 0} adds ${state.currency}${(amt * state.members.length).toLocaleString()} total (${state.currency}${amt || 0} × ${state.members.length} friends)`;
    } else {
      hintEl.textContent = '';
    }
  };

  amountInput.oninput = updateHint;
  memberSelect.onchange = updateHint;

  dateInput.value = new Date().toISOString().slice(0, 10);
  noteInput.value = '';
  amountInput.value = '';

  if (type === 'DEPOSIT') {
    title.textContent = 'Deposit Money to Group Kitty';
    amountLabel.innerHTML = `Amount per person / deposit (<span class="currency-label">${state.currency}</span>)`;
    memberGroup.style.display = 'block';
    memberSelect.value = 'ALL';
  } else if (type === 'WITHDRAW') {
    title.textContent = 'Withdraw Cash from Kitty';
    amountLabel.innerHTML = `Withdraw Amount (<span class="currency-label">${state.currency}</span>)`;
    memberGroup.style.display = 'block';
    memberSelect.value = 'POOL';
  } else if (type === 'MODIFY') {
    title.textContent = 'Adjust Kitty Balance';
    amountLabel.innerHTML = `New Kitty Balance (<span class="currency-label">${state.currency}</span>)`;
    amountInput.value = state.kitty.balance;
    memberGroup.style.display = 'none';
  }

  updateHint();
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
async function init() {
  // Mount 21st.dev Auckland Skyline Mosaic/ASCII effect in Trip Hero
  const heroCanvas = document.getElementById('trip-hero-ascii');
  if (heroCanvas) {
    mountAucklandSkylineCanvas(heroCanvas);
  }

  const params = new URLSearchParams(window.location.search);
  const tripId = params.get('trip');

  const user = await getUser();
  if (!user) {
    // Save shared trip ID so after login/signup the user lands right back in this trip!
    if (tripId) {
      localStorage.setItem('upmark_pending_trip', tripId);
      window.location.href = `./login.html?trip=${encodeURIComponent(tripId)}`;
    } else {
      window.location.href = './login.html';
    }
    return;
  }

  if (!tripId) {
    window.location.href = './trips.html';
    return;
  }

  setupEventListeners();

  try {
    await stateManager.init(tripId);
  } catch (err) {
    console.error('Failed to load trip:', err);
    window.location.href = './trips.html';
    return;
  }

  stateManager.subscribe(() => {
    renderApp();
    const active = getActiveUser();
    if (active) updateHeaderUserBadge(active);
  });

  renderApp();
  const active = getActiveUser();
  if (active) updateHeaderUserBadge(active);
}

init();
