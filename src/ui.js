// =========================================================================
// TRIP HISAB - USER INTERFACE RENDERER & INTERACTION HANDLERS (NO EMOJIS)
// =========================================================================

import { stateManager } from './state.js';
import { calculateTripSummary, generateIndividualReportText, generateGroupSummaryReportText } from './settlement.js';
import { exportToCSV, downloadBackupJSON, pushToGoogleSheet } from './sheets-sync.js';
import { ICONS, getCategoryIcon } from './icons.js';

let activeTab = 'dashboard';
let expenseFilter = 'all'; // 'all' | 'group' | 'personal'
let searchQuery = '';
let selectedSplitMembers = new Set();
let isPersonalExpenseMode = false;

/**
 * Toast Notification with Undo button
 */
export function showToast(message, actionLabel = 'Undo', onAction = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${message}</span>
    ${onAction ? `<button class="toast-undo-btn">${actionLabel}</button>` : ''}
  `;

  if (onAction) {
    const btn = toast.querySelector('.toast-undo-btn');
    btn.onclick = () => {
      onAction();
      toast.remove();
    };
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

/**
 * Main Render function - updates all views based on state
 */
export function renderApp() {
  const state = stateManager.state;
  const summary = calculateTripSummary(state);
  const curr = state.currency || '₹';

  // 1. Update Header
  document.getElementById('header-trip-name').textContent = state.tripName;
  document.getElementById('header-members-count').textContent = `${state.members.length} Friends`;
  
  // Currency labels
  document.querySelectorAll('.currency-label').forEach(el => el.textContent = curr);

  // Undo / Redo button states
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) {
    btnUndo.disabled = !stateManager.canUndo();
    const actionName = stateManager.getUndoActionName();
    btnUndo.title = actionName ? `Undo: ${actionName} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)';
  }
  if (btnRedo) {
    btnRedo.disabled = !stateManager.canRedo();
  }

  // Sync Pill in Header & Settings
  updateSyncStatusUI(state.settings?.syncStatus, state.settings?.lastSyncedAt);

  // Badge counts
  document.getElementById('badge-expenses-count').textContent = state.expenses.length;
  document.getElementById('badge-kitty-bal').textContent = `${curr}${summary.kittyBalance}`;
  document.getElementById('badge-notes-count').textContent = state.notes.length;

  // 2. Render Active Tab Views
  renderDashboard(summary, state);
  renderExpensesList(state, summary);
  renderSplitsAndReports(summary, state);
  renderKittyView(summary, state);
  renderNotesView(state);
  renderSettingsView(state);
}

/**
 * 1. Render Dashboard
 */
function renderDashboard(summary, state) {
  const curr = summary.currency;
  document.getElementById('dash-group-spend').textContent = `${curr}${summary.totalGroupSpend.toLocaleString()}`;
  document.getElementById('dash-per-person').textContent = `${curr}${summary.averageGroupPerPerson.toLocaleString()} / person`;
  document.getElementById('dash-kitty-balance').textContent = `${curr}${summary.kittyBalance.toLocaleString()}`;
  document.getElementById('dash-personal-spend').textContent = `${curr}${summary.totalPersonalSpend.toLocaleString()}`;
  document.getElementById('dash-total-count').textContent = state.expenses.length;
  document.getElementById('dash-active-members').textContent = `${state.members.length} active friends`;

  // Settlement Preview
  const settleContainer = document.getElementById('dash-settlements-list');
  if (summary.settlementTransfers.length === 0) {
    settleContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--color-green); font-size: 0.9rem; font-weight: 600;">
        All accounts are balanced. No pending dues.
      </div>`;
  } else {
    settleContainer.innerHTML = summary.settlementTransfers.slice(0, 3).map(t => `
      <div class="settlement-card">
        <div class="settlement-flow">
          <span class="avatar" style="background:#0F172A;">${t.fromAvatar}</span>
          <span>${t.fromName}</span>
          <span class="settlement-arrow" style="display:inline-flex; align-items:center;">${ICONS.arrowRight}</span>
          <span class="avatar" style="background:#0066FF;">${t.toAvatar}</span>
          <span>${t.toName}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="settlement-amount">${curr}${t.amount.toLocaleString()}</span>
          <button class="btn btn-sm btn-secondary btn-quick-settle" data-from="${t.fromId}" data-to="${t.toId}" data-amount="${t.amount}">
            Settle
          </button>
        </div>
      </div>
    `).join('');
  }

  // Category Breakdown
  const catContainer = document.getElementById('dash-category-breakdown');
  const catEntries = Object.entries(summary.categoryTotals);
  if (catEntries.length === 0) {
    catContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 16px; font-size: 0.85rem;">No expenses recorded yet.</div>`;
  } else {
    const total = summary.grandTotalSpend || 1;
    catContainer.innerHTML = catEntries.map(([cat, amount]) => {
      const pct = Math.round((amount / total) * 100);
      const icon = getCategoryIcon(cat);
      return `
        <div style="margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 600; margin-bottom: 4px; align-items: center;">
            <span style="display:inline-flex; align-items:center; gap: 6px;">${icon} ${cat}</span>
            <span>${curr}${amount.toLocaleString()} (${pct}%)</span>
          </div>
          <div style="height: 6px; background: var(--bg-subtle); border-radius: 4px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: var(--brand-blue); border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Recent Expenses (last 4)
  const recentContainer = document.getElementById('dash-recent-expenses-list');
  const recent = state.expenses.slice(0, 4);
  if (recent.length === 0) {
    recentContainer.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.88rem;">
        No expenses added yet. Tap <b>Add Expense</b> to begin!
      </div>`;
  } else {
    recentContainer.innerHTML = recent.map(e => renderExpenseItemHtml(e, state, summary.memberMap)).join('');
  }
}

/**
 * 2. Render Expenses Tab
 */
function renderExpensesList(state, summary) {
  const container = document.getElementById('expenses-full-list');
  if (!container) return;

  let filtered = state.expenses;

  // Filter: Group vs Personal
  if (expenseFilter === 'group') {
    filtered = filtered.filter(e => !e.isPersonal);
  } else if (expenseFilter === 'personal') {
    filtered = filtered.filter(e => e.isPersonal);
  }

  // Search query
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(e => {
      const titleMatch = (e.title || '').toLowerCase().includes(q);
      const catMatch = (e.category || '').toLowerCase().includes(q);
      const payerName = e.payerId === 'KITTY' ? 'kitty' : (summary.memberMap[e.payerId]?.name || '').toLowerCase();
      return titleMatch || catMatch || payerName.includes(q);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
        <div style="margin-bottom: 8px; color: var(--brand-blue);">${ICONS.search}</div>
        <div style="font-weight: 600;">No matching transactions found</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">Tap "Add New" to record a new expense.</div>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(e => renderExpenseItemHtml(e, state, summary.memberMap, true)).join('');
}

function renderExpenseItemHtml(e, state, memberMap, showActions = false) {
  const curr = state.currency || '₹';
  const icon = getCategoryIcon(e.category);
  const payerName = e.payerId === 'KITTY' ? 'Group Kitty' : (memberMap[e.payerId]?.name || 'Unknown');
  const isPersonal = e.isPersonal;

  let splitMeta = '';
  if (isPersonal) {
    splitMeta = `<span class="badge badge-personal">Personal Expense</span>`;
  } else if (e.payerId === 'KITTY') {
    splitMeta = `<span class="badge badge-blue">Paid by Kitty</span> • Split with ${e.splitWith?.length || 0}`;
  } else {
    const count = e.splitWith?.length || state.members.length;
    const perPerson = Math.round((e.amount / count) * 100) / 100;
    splitMeta = `Paid by <b>${payerName}</b> • ${curr}${perPerson}/person (${count} friends)`;
  }

  return `
    <div class="expense-item" data-expense-id="${e.id}">
      <div class="expense-left">
        <div class="expense-cat-icon">${icon}</div>
        <div class="expense-title-group">
          <div class="expense-title">
            <span>${escapeHtml(e.title)}</span>
          </div>
          <div class="expense-meta">
            <span>${e.date}</span> • 
            ${splitMeta}
            ${e.notes ? `• <span style="font-style:italic;">"${escapeHtml(e.notes)}"</span>` : ''}
          </div>
        </div>
      </div>

      <div class="expense-right">
        <div class="expense-amount">${curr}${Number(e.amount).toLocaleString()}</div>
        ${showActions ? `
          <div style="display: flex; gap: 6px; margin-top: 4px;">
            <button class="btn btn-sm btn-secondary btn-edit-exp" data-id="${e.id}" title="Edit" style="padding: 4px 6px;">
              ${ICONS.edit}
            </button>
            <button class="btn btn-sm btn-danger btn-delete-exp" data-id="${e.id}" title="Delete" style="padding: 4px 6px;">
              ${ICONS.trash}
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * 3. Render Split & Individual Reports
 */
function renderSplitsAndReports(summary, state) {
  const grid = document.getElementById('splits-members-grid');
  if (!grid) return;

  const curr = summary.currency;

  grid.innerHTML = summary.members.map(m => {
    let balBadge = '';
    let balText = '';
    if (m.netGroupBalance > 0.05) {
      balBadge = `<span class="badge badge-green">Gets Back</span>`;
      balText = `<span style="color: var(--color-green);">+${curr}${m.netGroupBalance.toLocaleString()}</span>`;
    } else if (m.netGroupBalance < -0.05) {
      balBadge = `<span class="badge badge-red">Owes</span>`;
      balText = `<span style="color: var(--color-red);">${curr}${Math.abs(m.netGroupBalance).toLocaleString()}</span>`;
    } else {
      balBadge = `<span class="badge" style="background:#F1F5F9; color:#475569;">Settled</span>`;
      balText = `<span>${curr}0</span>`;
    }

    return `
      <div class="member-report-card" data-member-id="${m.id}">
        <div class="member-card-top">
          <div class="member-info">
            <span class="avatar" style="background: ${m.color || '#0F172A'};">${m.avatar}</span>
            <div>
              <div class="member-name">${escapeHtml(m.name)}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${m.sharedTransactions.length} shared bills</div>
            </div>
          </div>
          ${balBadge}
        </div>

        <div class="member-metric-row">
          <span>Paid for Group:</span>
          <b>${curr}${m.paidForGroup.toLocaleString()}</b>
        </div>
        <div class="member-metric-row">
          <span>Share of Group:</span>
          <b>${curr}${m.shareOfGroup.toLocaleString()}</b>
        </div>
        <div class="member-metric-row">
          <span>Personal Spend:</span>
          <b>${curr}${m.personalSpend.toLocaleString()}</b>
        </div>
        <div class="member-metric-row balance-row">
          <span>Net Balance:</span>
          <b>${balText}</b>
        </div>

        <div style="margin-top: 10px; display: flex; gap: 6px;">
          <button class="btn btn-sm btn-secondary btn-full btn-view-member-report" data-id="${m.id}">
            View Report
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Optimal Settlements List
  const settleList = document.getElementById('splits-settlements-list');
  if (summary.settlementTransfers.length === 0) {
    settleList.innerHTML = `<div style="text-align: center; color: var(--color-green); padding: 14px; font-weight: 600;">All accounts are settled!</div>`;
  } else {
    settleList.innerHTML = summary.settlementTransfers.map(t => `
      <div class="settlement-card">
        <div class="settlement-flow">
          <span class="avatar" style="background:#0F172A;">${t.fromAvatar}</span>
          <span>${t.fromName}</span>
          <span class="settlement-arrow" style="display:inline-flex; align-items:center; gap: 4px;">
            ${ICONS.arrowRight} pays ${ICONS.arrowRight}
          </span>
          <span class="avatar" style="background:#0066FF;">${t.toAvatar}</span>
          <span>${t.toName}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="settlement-amount">${curr}${t.amount.toLocaleString()}</span>
          <button class="btn btn-sm btn-primary btn-quick-settle" data-from="${t.fromId}" data-to="${t.toId}" data-amount="${t.amount}">
            ${ICONS.handshake} Record Settle
          </button>
        </div>
      </div>
    `).join('');
  }

  // Settlement History
  const historyList = document.getElementById('splits-history-list');
  const history = state.settlements || [];
  if (history.length === 0) {
    historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 14px; font-size: 0.85rem;">No settlements recorded yet.</div>`;
  } else {
    historyList.innerHTML = history.map(s => {
      const fromName = summary.memberMap[s.from]?.name || s.from;
      const toName = summary.memberMap[s.to]?.name || s.to;
      return `
        <div class="expense-item">
          <div>
            <div style="font-size: 0.9rem; font-weight: 600;">
              ${fromName} paid ${curr}${s.amount.toLocaleString()} to ${toName}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${s.date} ${s.note ? `• ${s.note}` : ''}
            </div>
          </div>
          <button class="btn btn-sm btn-danger btn-delete-settlement" data-id="${s.id}" title="Delete settlement" style="padding: 4px 6px;">
            ${ICONS.trash}
          </button>
        </div>
      `;
    }).join('');
  }
}

/**
 * 4. Render Kitty (Group Pool) View
 */
function renderKittyView(summary, state) {
  const curr = summary.currency;
  document.getElementById('kitty-main-balance').textContent = `${curr}${summary.kittyBalance.toLocaleString()}`;

  const historyContainer = document.getElementById('kitty-history-list');
  const logs = (state.kitty?.history || []);

  if (logs.length === 0) {
    historyContainer.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem;">
        No pool transactions yet. Tap <b>Add / Deposit Money</b> when members contribute to the fund.
      </div>`;
  } else {
    historyContainer.innerHTML = logs.map(l => {
      const isAdd = l.type === 'DEPOSIT';
      const isExp = l.type === 'EXPENSE';
      const badgeClass = isAdd ? 'badge-green' : (isExp ? 'badge-blue' : 'badge-red');
      const sign = isAdd ? '+' : '-';
      const icon = isAdd ? ICONS.arrowDownLeft : (isExp ? ICONS.fileSpreadsheet : ICONS.arrowUpRight);

      return `
        <div class="expense-item">
          <div class="expense-left">
            <div class="expense-cat-icon">${icon}</div>
            <div class="expense-title-group">
              <div class="expense-title">
                <span class="badge ${badgeClass}">${l.type}</span>
                <span>${escapeHtml(l.note || l.type)}</span>
              </div>
              <div class="expense-meta">
                <span>${l.date}</span> • By: <b>${escapeHtml(l.member || 'Group')}</b> • Bal after: ${curr}${l.balanceAfter?.toLocaleString() || 0}
              </div>
            </div>
          </div>
          <div class="expense-right">
            <div class="expense-amount" style="color: ${isAdd ? 'var(--color-green)' : 'var(--text-primary)'};">
              ${sign}${curr}${l.amount?.toLocaleString() || 0}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

/**
 * 5. Render Notes & Numbers View
 */
function renderNotesView(state) {
  const container = document.getElementById('notes-cards-list');
  if (!container) return;

  if (state.notes.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
        <div style="margin-bottom: 8px; color: var(--brand-blue);">${ICONS.notes}</div>
        <div style="font-weight: 600;">No notes or contacts added yet</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">Store driver numbers, hotel booking IDs, and trip reminders here!</div>
      </div>`;
    return;
  }

  container.innerHTML = state.notes.map(n => {
    const isContact = n.type === 'contact';
    const isBooking = n.type === 'booking';
    const icon = isContact ? ICONS.call : (isBooking ? ICONS.catStay : ICONS.notes);
    
    // Check if contains phone number
    const phoneMatch = n.content.match(/(\+?\d[\d\s-]{8,})/);
    const phoneNumber = phoneMatch ? phoneMatch[0].replace(/\s+/g, '') : null;

    return `
      <div class="note-item-card">
        <div class="note-content-area">
          <div class="note-title">
            <span style="display:inline-flex; align-items:center;">${icon}</span>
            <span>${escapeHtml(n.title)}</span>
          </div>
          <div class="note-text">${escapeHtml(n.content)}</div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center;">
          ${phoneNumber ? `
            <a href="tel:${phoneNumber}" class="btn btn-sm btn-primary" title="Call Number">
              ${ICONS.call} Call
            </a>
          ` : ''}
          <button class="btn btn-sm btn-secondary btn-copy-note" data-content="${escapeHtml(n.content)}" title="Copy to clipboard">
            ${ICONS.copy} Copy
          </button>
          <button class="btn btn-sm btn-secondary btn-edit-note" data-id="${n.id}" title="Edit" style="padding: 4px 6px;">
            ${ICONS.edit}
          </button>
          <button class="btn btn-sm btn-danger btn-delete-note" data-id="${n.id}" title="Delete" style="padding: 4px 6px;">
            ${ICONS.trash}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 6. Render Settings View & Member Manager
 */
function renderSettingsView(state) {
  document.getElementById('input-trip-name').value = state.tripName;
  document.getElementById('select-currency').value = state.currency || '₹';
  document.getElementById('input-google-sheet-url').value = state.settings?.googleSheetUrl || '';
  
  const countLabel = document.getElementById('settings-members-count-label');
  if (countLabel) countLabel.textContent = state.members.length;

  const membersList = document.getElementById('settings-members-list');
  if (membersList) {
    if (state.members.length === 0) {
      membersList.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; padding: 8px 0;">No members yet. Add your friends above!</div>`;
    } else {
      membersList.innerHTML = state.members.map((m) => `
        <div style="display: flex; gap: 8px; align-items: center; background: #FFFFFF; border: 1px solid var(--border-color); padding: 8px 10px; border-radius: var(--radius-sm);">
          <span class="avatar" style="background: ${m.color};">${m.avatar}</span>
          <input type="text" class="form-control input-member-rename" data-id="${m.id}" value="${escapeHtml(m.name)}" style="font-weight: 600; padding: 6px 10px;">
          <button class="btn btn-sm btn-danger btn-remove-member" data-id="${m.id}" title="Remove ${escapeHtml(m.name)}" style="padding: 6px 10px;">
            ${ICONS.trash}
          </button>
        </div>
      `).join('');
    }
  }
}

/**
 * Sync status badge in header & settings
 */
export function updateSyncStatusUI(status, lastSyncedAt) {
  const headerPill = document.getElementById('header-sync-pill');
  const headerText = document.getElementById('sync-status-text');
  const settingsBadge = document.getElementById('settings-sync-badge');
  const settingsText = document.getElementById('settings-sync-text');

  const classes = ['offline', 'syncing', 'synced', 'error'];
  headerPill.classList.remove(...classes);
  if (settingsBadge) settingsBadge.classList.remove(...classes);

  let label = 'Local Save';
  let badgeClass = 'offline';

  if (status === 'syncing') {
    label = 'Syncing...';
    badgeClass = 'syncing';
  } else if (status === 'synced') {
    label = 'Synced to Sheet';
    badgeClass = 'synced';
  } else if (status === 'error') {
    label = 'Sync Error';
    badgeClass = 'error';
  }

  headerPill.classList.add(badgeClass);
  headerText.textContent = label;

  if (settingsBadge && settingsText) {
    settingsBadge.classList.add(badgeClass);
    settingsText.textContent = label;
  }
}

/**
 * Opens Member Detail Modal with Line-Item Breakdown
 */
export function openMemberDetailModal(memberId) {
  const state = stateManager.state;
  const summary = calculateTripSummary(state);
  const m = summary.memberMap[memberId];
  if (!m) return;

  const curr = summary.currency;
  document.getElementById('modal-member-title').innerHTML = `
    <span class="avatar" style="background:${m.color}; margin-right: 6px;">${m.avatar}</span>
    ${escapeHtml(m.name)}'s Report
  `;

  let netHtml = '';
  if (m.netGroupBalance > 0.05) {
    netHtml = `<span style="color: var(--color-green); font-size: 1.2rem; font-weight: 800;">Gets back +${curr}${m.netGroupBalance.toLocaleString()}</span>`;
  } else if (m.netGroupBalance < -0.05) {
    netHtml = `<span style="color: var(--color-red); font-size: 1.2rem; font-weight: 800;">Owes ${curr}${Math.abs(m.netGroupBalance).toLocaleString()}</span>`;
  } else {
    netHtml = `<span style="color: var(--text-secondary); font-size: 1.2rem; font-weight: 800;">All Settled (${curr}0)</span>`;
  }

  const toPay = summary.settlementTransfers.filter(t => t.fromId === memberId);
  const toReceive = summary.settlementTransfers.filter(t => t.toId === memberId);

  let settlementsHtml = '';
  if (toPay.length > 0) {
    settlementsHtml += `<div style="margin-top: 10px; padding: 10px; background: var(--color-red-light); border-radius: var(--radius-sm); border: 1px solid var(--color-red-border);">
      <div style="font-weight: 700; color: var(--color-red); margin-bottom: 4px;">Pending Payments:</div>
      ${toPay.map(t => `<div>Pay <b>${curr}${t.amount}</b> to <b>${t.toName}</b></div>`).join('')}
    </div>`;
  }
  if (toReceive.length > 0) {
    settlementsHtml += `<div style="margin-top: 10px; padding: 10px; background: var(--color-green-light); border-radius: var(--radius-sm); border: 1px solid var(--color-green-border);">
      <div style="font-weight: 700; color: var(--color-green); margin-bottom: 4px;">Pending Collections:</div>
      ${toReceive.map(t => `<div>Collect <b>${curr}${t.amount}</b> from <b>${t.fromName}</b></div>`).join('')}
    </div>`;
  }

  const body = document.getElementById('modal-member-body');
  body.innerHTML = `
    <div style="text-align: center; padding: 16px; background: var(--bg-surface); border-radius: var(--radius-md); margin-bottom: 16px;">
      <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Net Balance</div>
      <div style="margin: 4px 0;">${netHtml}</div>
      <div style="font-size: 0.82rem; color: var(--text-secondary);">Total Out of Pocket: <b>${curr}${m.totalOutPocket.toLocaleString()}</b></div>
      ${settlementsHtml}
    </div>

    <!-- Stats Table -->
    <div class="card" style="padding: 12px; margin-bottom: 16px;">
      <div class="member-metric-row"><span>Total Paid for Group:</span> <b>${curr}${m.paidForGroup.toLocaleString()}</b></div>
      <div class="member-metric-row"><span>Share of Group Expenses:</span> <b>${curr}${m.shareOfGroup.toLocaleString()}</b></div>
      <div class="member-metric-row"><span>Personal Solo Expenses:</span> <b>${curr}${m.personalSpend.toLocaleString()}</b></div>
    </div>

    <!-- Bills they paid -->
    <h4 style="font-size: 0.9rem; margin-bottom: 8px;">Bills Paid by ${escapeHtml(m.name)} (${m.paidTransactions.length})</h4>
    <div style="margin-bottom: 16px;">
      ${m.paidTransactions.length === 0 ? `<div style="color: var(--text-muted); font-size: 0.82rem;">None</div>` :
        m.paidTransactions.map(e => `
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color); font-size: 0.84rem;">
            <span>${escapeHtml(e.title)} (${e.date})</span>
            <b>${curr}${Number(e.amount).toLocaleString()}</b>
          </div>
        `).join('')}
    </div>

    <!-- Shared Bills they participated in -->
    <h4 style="font-size: 0.9rem; margin-bottom: 8px;">Group Bills Shared In (${m.sharedTransactions.length})</h4>
    <div style="margin-bottom: 16px;">
      ${m.sharedTransactions.length === 0 ? `<div style="color: var(--text-muted); font-size: 0.82rem;">None</div>` :
        m.sharedTransactions.map(e => `
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color); font-size: 0.84rem;">
            <span>${escapeHtml(e.title)} (Total ${curr}${e.amount})</span>
            <span style="color: var(--color-red);">Share: ${curr}${Math.round((e.myShare || 0) * 100) / 100}</span>
          </div>
        `).join('')}
    </div>

    <!-- Personal Expenses -->
    ${m.personalTransactions.length > 0 ? `
      <h4 style="font-size: 0.9rem; margin-bottom: 8px;">Personal Expenses (${m.personalTransactions.length})</h4>
      <div>
        ${m.personalTransactions.map(e => `
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color); font-size: 0.84rem;">
            <span>${escapeHtml(e.title)} (${e.date})</span>
            <b>${curr}${Number(e.amount).toLocaleString()}</b>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  // Bind WhatsApp share button
  const btnShare = document.getElementById('btn-share-member-whatsapp');
  btnShare.onclick = () => {
    const text = generateIndividualReportText(memberId, summary, state.tripName);
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  openModal('modal-member-detail');
}

/**
 * Prepares the Add/Edit Expense modal
 */
export function openExpenseModal(expenseToEdit = null) {
  const state = stateManager.state;
  const isEdit = !!expenseToEdit;

  document.getElementById('modal-expense-title').textContent = isEdit ? 'Edit Expense' : 'Add Expense';
  document.getElementById('input-expense-id').value = isEdit ? expenseToEdit.id : '';
  document.getElementById('input-exp-amount').value = isEdit ? expenseToEdit.amount : '';
  document.getElementById('input-exp-title').value = isEdit ? expenseToEdit.title : '';
  document.getElementById('select-exp-category').value = isEdit ? expenseToEdit.category : 'Food';
  document.getElementById('input-exp-date').value = isEdit ? expenseToEdit.date : new Date().toISOString().slice(0, 10);
  document.getElementById('input-exp-notes').value = isEdit ? (expenseToEdit.notes || '') : '';

  // Mode: Group vs Personal
  isPersonalExpenseMode = isEdit ? !!expenseToEdit.isPersonal : false;
  updateExpenseModeToggleUI();

  // Populate Payer Dropdown
  const payerSelect = document.getElementById('select-exp-payer');
  payerSelect.innerHTML = '';
  
  // Kitty option only for group expenses
  if (!isPersonalExpenseMode) {
    const kittyOpt = document.createElement('option');
    kittyOpt.value = 'KITTY';
    kittyOpt.textContent = `Group Kitty (Available: ${state.currency}${state.kitty.balance})`;
    payerSelect.appendChild(kittyOpt);
  }

  state.members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    payerSelect.appendChild(opt);
  });

  if (isEdit) {
    payerSelect.value = expenseToEdit.payerId;
  } else {
    // Default to first member
    payerSelect.value = state.members[0]?.id || 'm1';
  }

  // Populate Split Members Checkboxes
  if (isEdit && expenseToEdit.splitWith) {
    selectedSplitMembers = new Set(expenseToEdit.splitWith);
  } else {
    selectedSplitMembers = new Set(state.members.map(m => m.id));
  }
  renderSplitCheckboxes();

  openModal('modal-expense');
}

function updateExpenseModeToggleUI() {
  const btnGroup = document.getElementById('btn-toggle-group-exp');
  const btnPersonal = document.getElementById('btn-toggle-personal-exp');
  const splitSection = document.getElementById('group-split-section');
  const labelWhoPaid = document.getElementById('label-who-paid');

  if (isPersonalExpenseMode) {
    btnGroup.classList.remove('active');
    btnPersonal.classList.add('active');
    splitSection.style.display = 'none';
    labelWhoPaid.textContent = 'Person (Solo Spender)';
  } else {
    btnGroup.classList.add('active');
    btnPersonal.classList.remove('active');
    splitSection.style.display = 'block';
    labelWhoPaid.textContent = 'Paid By';
  }
}

export function setExpenseMode(isPersonal) {
  isPersonalExpenseMode = isPersonal;
  updateExpenseModeToggleUI();

  // Refresh payer dropdown to include/exclude Kitty
  const state = stateManager.state;
  const payerSelect = document.getElementById('select-exp-payer');
  const currentVal = payerSelect.value;
  payerSelect.innerHTML = '';

  if (!isPersonalExpenseMode) {
    const kittyOpt = document.createElement('option');
    kittyOpt.value = 'KITTY';
    kittyOpt.textContent = `Group Kitty (Available: ${state.currency}${state.kitty.balance})`;
    payerSelect.appendChild(kittyOpt);
  }

  state.members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    payerSelect.appendChild(opt);
  });

  if (currentVal && payerSelect.querySelector(`option[value="${currentVal}"]`)) {
    payerSelect.value = currentVal;
  } else {
    payerSelect.value = state.members[0]?.id || 'm1';
  }
  updateSplitPreview();
}

function renderSplitCheckboxes() {
  const container = document.getElementById('split-members-checkboxes');
  const state = stateManager.state;
  if (!container) return;

  container.innerHTML = state.members.map(m => {
    const checked = selectedSplitMembers.has(m.id);
    return `
      <label class="split-member-checkbox-card ${checked ? 'selected' : ''}">
        <input type="checkbox" class="cb-split-member" value="${m.id}" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(m.name)}</span>
      </label>
    `;
  }).join('');

  document.getElementById('split-selected-count').textContent = selectedSplitMembers.size;
  updateSplitPreview();
}

export function updateSplitPreview() {
  const amount = parseFloat(document.getElementById('input-exp-amount').value) || 0;
  const count = selectedSplitMembers.size;
  const curr = stateManager.state.currency || '₹';
  const preview = document.getElementById('split-per-person-preview');

  if (count === 0) {
    preview.textContent = 'Select at least 1 person';
    preview.style.color = 'var(--color-red)';
  } else {
    const perPerson = Math.round((amount / count) * 100) / 100;
    preview.textContent = `${count} people • ${curr}${perPerson.toLocaleString()} each`;
    preview.style.color = 'var(--brand-blue)';
  }
}

/**
 * Open Modal helper
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

/**
 * Switch Active Tab
 */
export function setActiveTab(tabName) {
  activeTab = tabName;

  // Header & Mobile Nav active state
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Toggle View Containers
  document.querySelectorAll('.tab-view').forEach(view => {
    view.style.display = view.id === `view-${tabName}` ? 'block' : 'none';
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function setExpenseFilter(filterName) {
  expenseFilter = filterName;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filterName);
  });
  renderExpensesList(stateManager.state, calculateTripSummary(stateManager.state));
}

export function setSearchQuery(query) {
  searchQuery = query;
  renderExpensesList(stateManager.state, calculateTripSummary(stateManager.state));
}

export function getSelectedSplitMembers() {
  return Array.from(selectedSplitMembers);
}

export function toggleSplitMember(memberId, isSelected) {
  if (isSelected) {
    selectedSplitMembers.add(memberId);
  } else {
    selectedSplitMembers.delete(memberId);
  }
  renderSplitCheckboxes();
}

export function selectAllSplitMembers() {
  selectedSplitMembers = new Set(stateManager.state.members.map(m => m.id));
  renderSplitCheckboxes();
}

export function clearAllSplitMembers() {
  selectedSplitMembers.clear();
  renderSplitCheckboxes();
}

export function isPersonalMode() {
  return isPersonalExpenseMode;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
