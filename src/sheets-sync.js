// =========================================================================
// TRIP HISAB - GOOGLE SHEETS SYNC & BACKUP ENGINE
// =========================================================================

import { calculateTripSummary } from './settlement.js';

/**
 * Pushes the full trip state and calculated summaries to Google Apps Script Web App
 */
export async function pushToGoogleSheet(state, isManual = false) {
  const url = state.settings?.googleSheetUrl;
  if (!url || !url.startsWith('http')) {
    state.settings.syncStatus = 'offline';
    return { success: false, message: 'No Google Sheet Web App URL configured' };
  }

  state.settings.syncStatus = 'syncing';
  if (window.__tripHisabStateManager) {
    window.__tripHisabStateManager.notify({ type: 'sync_status', status: 'syncing' });
  }

  try {
    const summary = calculateTripSummary(state);
    const payload = {
      tripName: state.tripName,
      currency: state.currency,
      members: state.members,
      expenses: state.expenses,
      kitty: state.kitty,
      settlements: state.settlements,
      notes: state.notes,
      summary: {
        totalGroupSpend: summary.totalGroupSpend,
        totalPersonalSpend: summary.totalPersonalSpend,
        kittyBalance: summary.kittyBalance,
        members: summary.memberMap
      },
      exportedAt: new Date().toISOString()
    };

    // Google Apps Script Web Apps handle POST requests.
    // Using standard fetch with text payload.
    // In browsers, GAS redirects with 302. Using mode 'no-cors' guarantees delivery without CORS console noise.
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    state.settings.syncStatus = 'synced';
    state.settings.lastSyncedAt = new Date().toISOString();

    if (window.__tripHisabStateManager) {
      window.__tripHisabStateManager.notify({
        type: 'sync_status',
        status: 'synced',
        lastSyncedAt: state.settings.lastSyncedAt
      });
    }

    return { success: true, timestamp: state.settings.lastSyncedAt };
  } catch (err) {
    console.error('Google Sheet Sync Error:', err);
    state.settings.syncStatus = 'error';
    if (window.__tripHisabStateManager) {
      window.__tripHisabStateManager.notify({ type: 'sync_status', status: 'error', error: err.message });
    }
    return { success: false, error: err.message };
  }
}

/**
 * Pull latest state from Google Sheet Web App (doGet)
 */
export async function pullFromGoogleSheet(url) {
  if (!url || !url.startsWith('http')) {
    throw new Error('Please enter a valid Google Apps Script Web App URL');
  }

  const response = await fetch(url, {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch from sheet: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.status === 'empty') {
    throw new Error('Google Sheet is empty. Push data from Trip Hisab first to initialize.');
  }

  return data;
}

/**
 * Exports complete hisab data as a clean CSV file
 */
export function exportToCSV(state) {
  const summary = calculateTripSummary(state);
  const memberMap = summary.memberMap;
  const curr = state.currency || '₹';

  let csv = `TRIP HISAB REPORT - ${state.tripName}\n`;
  csv += `Export Date,${new Date().toLocaleString()}\n`;
  csv += `Total Group Spend,${curr} ${summary.totalGroupSpend}\n`;
  csv += `Kitty Balance,${curr} ${summary.kittyBalance}\n\n`;

  // Member Summary
  csv += `--- INDIVIDUAL BALANCES ---\n`;
  csv += `Member,Paid For Group,Share of Group,Net Balance,Personal Spend,Total Out of Pocket\n`;
  summary.members.forEach(m => {
    csv += `"${m.name}",${m.paidForGroup},${m.shareOfGroup},${m.netGroupBalance},${m.personalSpend},${m.totalOutPocket}\n`;
  });
  csv += `\n`;

  // Settlement Transfers
  csv += `--- SIMPLIFIED SETTLEMENTS (WHO PAYS WHOM) ---\n`;
  csv += `From (Debtor),To (Creditor),Amount (${curr})\n`;
  summary.settlementTransfers.forEach(t => {
    csv += `"${t.fromName}","${t.toName}",${t.amount}\n`;
  });
  csv += `\n`;

  // Expenses Breakdown
  csv += `--- ALL EXPENSES ---\n`;
  csv += `Date,Type,Title,Category,Amount (${curr}),Paid By,Split Between,Notes\n`;
  state.expenses.forEach(e => {
    const type = e.isPersonal ? 'Personal' : 'Group';
    const payer = e.payerId === 'KITTY' ? 'Group Kitty' : (memberMap[e.payerId]?.name || 'Unknown');
    const splitNames = e.isPersonal ? '-' : (e.splitWith || []).map(id => memberMap[id]?.name || id).join('; ');
    const note = (e.notes || '').replace(/"/g, '""');
    csv += `"${e.date}","${type}","${e.title}","${e.category}",${e.amount},"${payer}","${splitNames}","${note}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${state.tripName.replace(/[^a-zA-Z0-9]/g, '_')}_hisab_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

/**
 * Downloads full state as JSON backup
 */
export function downloadBackupJSON(state) {
  const jsonStr = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${state.tripName.replace(/[^a-zA-Z0-9]/g, '_')}_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}
