// =========================================================================
// TRIP HISAB - USER INTERFACE RENDERER & INTERACTION HANDLERS (NO EMOJIS)
// =========================================================================

import { stateManager } from './db-state.js';
import { calculateTripSummary, generateIndividualReportText } from './settlement.js';
import { ICONS, getCategoryIcon } from './icons.js';

let activeTab = 'dashboard';
let expenseFilter = 'all'; // 'all' | 'group' | 'personal'
let searchQuery = '';
let selectedSplitMembers = new Set();
let isPersonalExpenseMode = false;

/**
 * Toast Notification
 */
export function showToast(message, actionLabel = null, onAction = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    ${onAction && actionLabel ? `<button class="toast-undo-btn">${escapeHtml(actionLabel)}</button>` : ''}
  `;

  if (onAction) {
    const btn = toast.querySelector('.toast-undo-btn');
    if (btn) {
      btn.onclick = () => {
        onAction();
        toast.remove();
      };
    }
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s';
    setTimeout(() => toast.remove(), 200);
  }, 3600);
}

/**
 * Main Render function - updates all views based on live Supabase state
 */
export function renderApp() {
  const state = stateManager.state;
  const summary = calculateTripSummary(state);
  const curr = state.currency || '₹';

  // 1. Update Header
  const headerName = document.getElementById('header-trip-name');
  if (headerName) headerName.textContent = state.tripName || 'My Trip';

  const headerMembers = document.getElementById('header-members-count');
  if (headerMembers) {
    const count = state.members?.length || 1;
    headerMembers.textContent = `${count} ${count === 1 ? 'Friend' : 'Friends'}`;
  }

  document.querySelectorAll('.currency-label').forEach(el => {
    el.textContent = curr;
  });

  updateSyncStatusUI(state.settings?.syncStatus, state.settings?.lastSyncedAt);

  // Badge counts
  const expBadge = document.getElementById('badge-expenses-count');
  if (expBadge) expBadge.textContent = (state.expenses || []).length;

  const kittyBadge = document.getElementById('badge-kitty-bal');
  if (kittyBadge) kittyBadge.textContent = `${curr}${summary.kittyBalance.toLocaleString()}`;

  const notesBadge = document.getElementById('badge-notes-count');
  if (notesBadge) notesBadge.textContent = (state.notes || []).length;

  const chatBadge = document.getElementById('badge-chat-count');
  if (chatBadge) {
    const msgCount = (state.messages || []).length;
    chatBadge.textContent = msgCount;
    chatBadge.style.display = msgCount > 0 ? 'inline-flex' : 'none';
  }

  // 2. Render All Views
  renderDashboard(summary, state);
  renderExpensesList(state, summary);
  renderSplitsAndReports(summary, state);
  renderKittyView(summary, state);
  renderNotesView(state);
  renderChatView(state);
  renderRouteView(state);
  renderSettingsView(state);
}

/**
 * 1. Render Dashboard
 */
function renderDashboard(summary, state) {
  const curr = summary.currency;
  const groupSpendEl = document.getElementById('dash-group-spend');
  if (groupSpendEl) groupSpendEl.textContent = `${curr}${summary.totalGroupSpend.toLocaleString()}`;

  const perPersonEl = document.getElementById('dash-per-person');
  if (perPersonEl) perPersonEl.textContent = `${curr}${summary.averageGroupPerPerson.toLocaleString()} / person`;

  const kittyBalEl = document.getElementById('dash-kitty-balance');
  if (kittyBalEl) kittyBalEl.textContent = `${curr}${summary.kittyBalance.toLocaleString()}`;

  const personalSpendEl = document.getElementById('dash-personal-spend');
  if (personalSpendEl) personalSpendEl.textContent = `${curr}${summary.totalPersonalSpend.toLocaleString()}`;

  const totalCountEl = document.getElementById('dash-total-count');
  if (totalCountEl) totalCountEl.textContent = (state.expenses || []).length;

  const activeMembersEl = document.getElementById('dash-active-members');
  if (activeMembersEl) {
    const c = (state.members || []).length;
    activeMembersEl.textContent = `${c} active ${c === 1 ? 'friend' : 'friends'}`;
  }

  // Invite Banner
  const inviteCodeEl = document.getElementById('dash-invite-code');
  if (inviteCodeEl) inviteCodeEl.textContent = state.inviteCode || '------';

  const shareInput = document.getElementById('dash-share-url-input');
  if (shareInput && state.tripId) {
    shareInput.value = `${window.location.origin}/index.html?trip=${state.tripId}`;
  }

  // Settlement Preview
  const settleContainer = document.getElementById('dash-settlements-list');
  if (settleContainer) {
    if (summary.settlementTransfers.length === 0) {
      settleContainer.innerHTML = `
        <div style="text-align: center; padding: 20px 10px; color: var(--color-green); font-size: 0.88rem; font-weight: 700;">
          All accounts are balanced. Zero pending dues.
        </div>`;
    } else {
      settleContainer.innerHTML = summary.settlementTransfers.slice(0, 3).map(t => `
        <div class="settlement-card">
          <div class="settlement-flow">
            <span class="avatar" style="background:#0F172A;">${escapeHtml(t.fromAvatar)}</span>
            <span>${escapeHtml(t.fromName)}</span>
            <span class="settlement-arrow" style="display:inline-flex; align-items:center;">${ICONS.arrowRight}</span>
            <span class="avatar" style="background:#0066FF;">${escapeHtml(t.toAvatar)}</span>
            <span>${escapeHtml(t.toName)}</span>
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
  }

  // Category Breakdown
  const catContainer = document.getElementById('dash-category-breakdown');
  if (catContainer) {
    const catEntries = Object.entries(summary.categoryTotals);
    if (catEntries.length === 0) {
      catContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 18px; font-size: 0.85rem;">No expenses recorded yet.</div>`;
    } else {
      const total = summary.grandTotalSpend || 1;
      catContainer.innerHTML = catEntries.map(([cat, amount]) => {
        const pct = Math.round((amount / total) * 100);
        const icon = getCategoryIcon(cat);
        return `
          <div style="margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700; margin-bottom: 4px; align-items: center;">
              <span style="display:inline-flex; align-items:center; gap: 6px;">${icon} ${escapeHtml(cat)}</span>
              <span>${curr}${amount.toLocaleString()} (${pct}%)</span>
            </div>
            <div style="height: 7px; background: var(--bg-subtle); border-radius: 99px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #0066FF, #38BDF8); border-radius: 99px;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Recent Expenses (last 5)
  const recentContainer = document.getElementById('dash-recent-expenses-list');
  if (recentContainer) {
    const recent = (state.expenses || []).slice(0, 5);
    if (recent.length === 0) {
      recentContainer.innerHTML = `
        <div style="text-align: center; padding: 26px 12px; color: var(--text-muted); font-size: 0.86rem;">
          No expenses added yet. Tap <b>Add Expense</b> to record your first trip bill!
        </div>`;
    } else {
      recentContainer.innerHTML = recent.map(e => renderExpenseItemHtml(e, state, summary.memberMap)).join('');
    }
  }
}

/**
 * 2. Render Expenses Tab
 */
function renderExpensesList(state, summary) {
  const container = document.getElementById('expenses-full-list');
  if (!container) return;

  let filtered = state.expenses || [];

  if (expenseFilter === 'group') {
    filtered = filtered.filter(e => !e.isPersonal);
  } else if (expenseFilter === 'personal') {
    filtered = filtered.filter(e => e.isPersonal);
  }

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
        <div style="font-weight: 700; color: var(--text-primary);">No matching bills found</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">Tap "Add New" to record an expense.</div>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(e => renderExpenseItemHtml(e, state, summary.memberMap, true)).join('');
}

function renderExpenseItemHtml(e, state, memberMap, showActions = false) {
  const curr = state.currency || '₹';
  const icon = getCategoryIcon(e.category);
  const payerName = e.payerId === 'KITTY' ? 'Group Kitty' : (memberMap[e.payerId]?.name || 'Member');
  const isPersonal = e.isPersonal;

  let splitMeta = '';
  if (isPersonal) {
    splitMeta = `<span class="badge badge-personal">Personal</span>`;
  } else if (e.payerId === 'KITTY') {
    splitMeta = `<span class="badge badge-blue">Paid by Kitty</span> · Split with ${e.splitWith?.length || state.members.length}`;
  } else {
    const count = e.splitWith?.length || state.members.length || 1;
    const perPerson = Math.round((e.amount / count) * 100) / 100;
    splitMeta = `Paid by <b>${escapeHtml(payerName)}</b> · ${curr}${perPerson}/each (${count})`;
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
            <span>${escapeHtml(e.date || '')}</span> · ${splitMeta}
            ${e.notes ? `· <span style="font-style:italic;">"${escapeHtml(e.notes)}"</span>` : ''}
          </div>
        </div>
      </div>

      <div class="expense-right">
        <div class="expense-amount">${curr}${Number(e.amount).toLocaleString()}</div>
        ${showActions ? `
          <div style="display: flex; gap: 6px; margin-top: 4px;">
            <button class="btn btn-sm btn-secondary btn-edit-exp" data-id="${e.id}" title="Edit" style="padding: 4px 7px;">
              ${ICONS.edit}
            </button>
            <button class="btn btn-sm btn-danger btn-delete-exp" data-id="${e.id}" title="Delete" style="padding: 4px 7px;">
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
            <span class="avatar" style="background: ${m.color || '#0F172A'};">${escapeHtml(m.avatar)}</span>
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

        <div style="margin-top: 10px;">
          <button class="btn btn-sm btn-secondary btn-full btn-view-member-report" data-id="${m.id}">
            View Full Breakdown
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Optimal Settlements List
  const settleList = document.getElementById('splits-settlements-list');
  if (settleList) {
    if (summary.settlementTransfers.length === 0) {
      settleList.innerHTML = `<div style="text-align: center; color: var(--color-green); padding: 14px; font-weight: 700;">All balances are settled!</div>`;
    } else {
      settleList.innerHTML = summary.settlementTransfers.map(t => `
        <div class="settlement-card">
          <div class="settlement-flow">
            <span class="avatar" style="background:#0F172A;">${escapeHtml(t.fromAvatar)}</span>
            <span>${escapeHtml(t.fromName)}</span>
            <span class="settlement-arrow" style="display:inline-flex; align-items:center; gap: 4px;">
              ${ICONS.arrowRight} pays
            </span>
            <span class="avatar" style="background:#0066FF;">${escapeHtml(t.toAvatar)}</span>
            <span>${escapeHtml(t.toName)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="settlement-amount">${curr}${t.amount.toLocaleString()}</span>
            <button class="btn btn-sm btn-primary btn-quick-settle" data-from="${t.fromId}" data-to="${t.toId}" data-amount="${t.amount}">
              Settle
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  // Settlement History
  const historyList = document.getElementById('splits-history-list');
  if (historyList) {
    const history = state.settlements || [];
    if (history.length === 0) {
      historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 14px; font-size: 0.84rem;">No settlements recorded yet.</div>`;
    } else {
      historyList.innerHTML = history.map(s => {
        const fromName = summary.memberMap[s.from]?.name || 'Member';
        const toName = summary.memberMap[s.to]?.name || 'Member';
        return `
          <div class="expense-item">
            <div>
              <div style="font-size: 0.88rem; font-weight: 700;">
                ${escapeHtml(fromName)} paid ${curr}${s.amount.toLocaleString()} to ${escapeHtml(toName)}
              </div>
              <div style="font-size: 0.74rem; color: var(--text-muted);">
                ${escapeHtml(s.date || '')} ${s.note ? `· ${escapeHtml(s.note)}` : ''}
              </div>
            </div>
            <button class="btn btn-sm btn-danger btn-delete-settlement" data-id="${s.id}" title="Delete" style="padding: 4px 7px;">
              ${ICONS.trash}
            </button>
          </div>
        `;
      }).join('');
    }
  }
}

/**
 * 4. Render Kitty (Group Pool) View
 */
function renderKittyView(summary, state) {
  const curr = summary.currency;
  const balEl = document.getElementById('kitty-main-balance');
  if (balEl) balEl.textContent = `${curr}${summary.kittyBalance.toLocaleString()}`;

  const historyContainer = document.getElementById('kitty-history-list');
  if (!historyContainer) return;

  const logs = state.kitty?.history || [];
  if (logs.length === 0) {
    historyContainer.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem;">
        No pool transactions yet. Tap <b>Deposit Money</b> when friends contribute to the common fund.
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
                <span class="badge ${badgeClass}">${escapeHtml(l.type)}</span>
                <span>${escapeHtml(l.note || l.type)}</span>
              </div>
              <div class="expense-meta">
                <span>${escapeHtml(l.date || '')}</span> · By: <b>${escapeHtml(l.member || 'Group')}</b> · Bal: ${curr}${l.balanceAfter?.toLocaleString() || 0}
              </div>
            </div>
          </div>
          <div class="expense-right" style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <div class="expense-amount" style="color: ${isAdd ? 'var(--color-green)' : 'var(--text-primary)'};">
              ${sign}${curr}${l.amount?.toLocaleString() || 0}
            </div>
            <div style="display: flex; gap: 6px; margin-top: 2px;">
              <button class="btn btn-sm btn-danger btn-delete-kitty" data-id="${l.id}" title="Delete" style="padding: 4px 7px;">
                ${ICONS.trash}
              </button>
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

  const notes = state.notes || [];
  if (notes.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
        <div style="margin-bottom: 8px; color: var(--brand-blue);">${ICONS.notes}</div>
        <div style="font-weight: 700; color: var(--text-primary);">No notes or contacts saved yet</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">Save driver numbers, hotel booking IDs, and checklists here.</div>
      </div>`;
    return;
  }

  container.innerHTML = notes.map(n => {
    const isContact = n.type === 'contact';
    const isBooking = n.type === 'booking';
    const icon = isContact ? ICONS.call : (isBooking ? ICONS.catStay : ICONS.notes);
    const phoneMatch = (n.content || '').match(/(\+?\d[\d\s-]{8,})/);
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
        <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center; flex-wrap: wrap;">
          ${phoneNumber ? `
            <a href="tel:${phoneNumber}" class="btn btn-sm btn-primary" title="Call Number">
              ${ICONS.call} Call
            </a>
          ` : ''}
          <button class="btn btn-sm btn-secondary btn-copy-note" data-content="${escapeHtml(n.content)}" title="Copy">
            ${ICONS.copy}
          </button>
          <button class="btn btn-sm btn-secondary btn-edit-note" data-id="${n.id}" title="Edit" style="padding: 4px 7px;">
            ${ICONS.edit}
          </button>
          <button class="btn btn-sm btn-danger btn-delete-note" data-id="${n.id}" title="Delete" style="padding: 4px 7px;">
            ${ICONS.trash}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 6. Render Trip Chat View
 */
export function renderChatView(state) {
  const container = document.getElementById('chat-messages-box');
  if (!container) return;
  const messages = state.messages || [];
  const currentUserId = stateManager.currentUser?.id;
  const currentMemberName = stateManager.currentMember?.name;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty-state">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p style="font-weight:600; color:var(--text-primary); margin-top:6px;">Group Chat is Ready</p>
        <p style="font-size:0.78rem; margin-top:2px;">Send a message below to chat with everyone in this trip!</p>
      </div>`;
    return;
  }

  container.innerHTML = messages.map(m => {
    const isSelf = (m.user_id && currentUserId && m.user_id === currentUserId) ||
                   (currentMemberName && m.sender_name === currentMemberName);
    const timeStr = m.created_at
      ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const avatarChar = (m.sender_name || 'T').charAt(0).toUpperCase();
    const avatarColor = m.sender_color || '#0066FF';

    return `
      <div class="chat-msg-row ${isSelf ? 'self' : 'other'}">
        <div class="chat-msg-avatar" style="background: ${avatarColor};">${escapeHtml(avatarChar)}</div>
        <div class="chat-msg-content">
          <div class="chat-msg-sender">${escapeHtml(m.sender_name || 'Traveler')}</div>
          <div class="chat-msg-bubble ${isSelf ? 'self' : 'other'}">
            <div>${escapeHtml(m.message)}</div>
            <div class="chat-msg-time">${timeStr}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

/**
 * 7. Interactive Multi-Destination Route & Time Calculator (Nominatim + OSRM + Haversine)
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatDurationHours(hours) {
  if (hours <= 0) return '0 mins';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} mins`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h} hrs`;
}

function addHoursToTimeString(startTimeStr, hoursToAdd) {
  const parts = String(startTimeStr || '08:00').split(':');
  const baseH = parseInt(parts[0], 10) || 8;
  const baseM = parseInt(parts[1], 10) || 0;
  const totalMinutes = Math.round(baseH * 60 + baseM + hoursToAdd * 60);
  const dayOffset = Math.floor(totalMinutes / 1440);
  const minsInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(minsInDay / 60);
  const m = minsInDay % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  const timeFormatted = `${h12}:${String(m).padStart(2, '0')} ${period}`;
  return dayOffset > 0 ? `${timeFormatted} (+${dayOffset}d)` : timeFormatted;
}

let routeMapInstance = null;
let routePolylineLayer = null;
let routeMarkersLayer = null;
let lastOsrmSignature = '';

export function invalidateRouteMapSize() {
  if (routeMapInstance) {
    setTimeout(() => {
      try { routeMapInstance.invalidateSize(); } catch (e) {}
    }, 150);
  }
}

export function initOrUpdateRouteMap(destinations) {
  const mapEl = document.getElementById('route-map');
  if (!mapEl || typeof L === 'undefined') return;

  if (!routeMapInstance) {
    routeMapInstance = L.map('route-map').setView([21.1458, 79.0882], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap'
    }).addTo(routeMapInstance);

    // Allow tapping anywhere on the map to add a destination stop!
    routeMapInstance.on('click', async (e) => {
      const lat = Number(e.latlng.lat.toFixed(5));
      const lng = Number(e.latlng.lng.toFixed(5));
      const latInput = document.getElementById('input-stop-lat');
      const lngInput = document.getElementById('input-stop-lng');
      const nameInput = document.getElementById('input-stop-name');
      if (latInput && lngInput && nameInput) {
        latInput.value = lat;
        lngInput.value = lng;
        nameInput.value = `Loading place (${lat}, ${lng})...`;
        openModal('modal-add-stop');
        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12`);
          const data = await resp.json();
          const placeName = data?.address?.city || data?.address?.town || data?.address?.village || data?.address?.county || data?.name || (data?.display_name ? data.display_name.split(',')[0] : `Stop (${lat}, ${lng})`);
          nameInput.value = placeName;
        } catch (err) {
          nameInput.value = `Waypoint (${lat}, ${lng})`;
        }
      }
    });
  }

  if (routePolylineLayer) routeMapInstance.removeLayer(routePolylineLayer);
  if (routeMarkersLayer) routeMapInstance.removeLayer(routeMarkersLayer);

  routeMarkersLayer = L.layerGroup().addTo(routeMapInstance);

  const validStops = (destinations || []).filter(d => parseFloat(d.lat) && parseFloat(d.lng));
  if (validStops.length === 0) return;

  const latlngs = [];
  validStops.forEach((stop, idx) => {
    const lat = parseFloat(stop.lat);
    const lng = parseFloat(stop.lng);
    latlngs.push([lat, lng]);

    const color = idx === 0 ? '#16A34A' : (idx === validStops.length - 1 ? '#DC2626' : '#0066FF');
    const marker = L.circleMarker([lat, lng], {
      radius: 10,
      fillColor: color,
      color: '#FFFFFF',
      weight: 2.5,
      opacity: 1,
      fillOpacity: 0.95
    }).addTo(routeMarkersLayer);

    marker.bindPopup(`<b>Stop ${idx + 1}: ${escapeHtml(stop.name)}</b><br>${escapeHtml(stop.stay_notes || 'Click Add Stop to extend route')}`);
  });

  if (latlngs.length > 1) {
    // Draw immediate fallback polyline first
    routePolylineLayer = L.polyline(latlngs, {
      color: '#0066FF',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.85
    }).addTo(routeMapInstance);

    try {
      routeMapInstance.fitBounds(routePolylineLayer.getBounds(), { padding: [36, 36] });
    } catch (e) {}

    // Fetch real road geometry from OSRM if driving/bus mode
    const sig = validStops.map(s => `${s.lng},${s.lat}`).join(';');
    if (sig !== lastOsrmSignature) {
      lastOsrmSignature = sig;
      fetch(`https://router.project-osrm.org/route/v1/driving/${sig}?overview=full&geometries=geojson`)
        .then(r => r.json())
        .then(data => {
          if (data?.routes?.[0]?.geometry?.coordinates && routeMapInstance) {
            const roadCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            if (routePolylineLayer) routeMapInstance.removeLayer(routePolylineLayer);
            routePolylineLayer = L.polyline(roadCoords, {
              color: '#0066FF',
              weight: 4.5,
              opacity: 0.9
            }).addTo(routeMapInstance);
          }
        })
        .catch(() => {});
    }
  } else if (latlngs.length === 1) {
    routeMapInstance.setView(latlngs[0], 10);
  }
}

export function renderRouteView(state) {
  const stops = state.destinations || [];
  const speedEl = document.getElementById('route-transit-speed');
  const speedKmh = parseFloat(speedEl ? speedEl.value : 60) || 60;
  const departEl = document.getElementById('route-departure-time');
  const departTimeStr = departEl?.value || '08:00';

  // Road distance multiplier (1.22x straight-line distance for road trips, 1.0x for flights)
  const windingFactor = speedKmh >= 400 ? 1.0 : 1.22;

  let totalKm = 0;
  let cumulativeHours = 0;
  const legs = [];

  for (let i = 0; i < stops.length; i++) {
    if (i > 0) {
      const prev = stops[i - 1];
      const curr = stops[i];
      let legDist = 0;
      if (prev.lat && prev.lng && curr.lat && curr.lng) {
        const straight = haversineKm(parseFloat(prev.lat), parseFloat(prev.lng), parseFloat(curr.lat), parseFloat(curr.lng));
        legDist = Math.round(straight * windingFactor);
      }
      totalKm += legDist;
      const legTime = legDist > 0 ? (legDist / speedKmh) : 0;
      cumulativeHours += legTime;
      legs.push({
        from: prev.name,
        to: curr.name,
        distanceKm: legDist,
        timeHours: legTime,
        etaStr: addHoursToTimeString(departTimeStr, cumulativeHours)
      });
    }
  }

  const stopsCountEl = document.getElementById('route-total-stops');
  if (stopsCountEl) stopsCountEl.textContent = stops.length;

  const totalDistEl = document.getElementById('route-total-distance');
  if (totalDistEl) totalDistEl.textContent = `${totalKm.toLocaleString()} km`;

  const totalTimeEl = document.getElementById('route-total-time');
  if (totalTimeEl) totalTimeEl.textContent = formatDurationHours(cumulativeHours);

  const finalEtaEl = document.getElementById('route-final-eta-badge');
  if (finalEtaEl) {
    if (stops.length > 1 && totalKm > 0) {
      finalEtaEl.textContent = `Final Arrival ETA: ${addHoursToTimeString(departTimeStr, cumulativeHours)}`;
    } else {
      finalEtaEl.textContent = '';
    }
  }

  const timelineEl = document.getElementById('route-stops-timeline');
  if (timelineEl) {
    if (stops.length === 0) {
      timelineEl.innerHTML = `
        <div style="text-align: center; padding: 26px 12px; color: var(--text-muted); font-size: 0.86rem; background: var(--bg-surface); border-radius: 14px; border: 1px dashed var(--border-color);">
          No stops added yet. Search a place above, tap on the map, or click <b>Add Stop</b> to build your route!
        </div>`;
    } else {
      let html = '';
      stops.forEach((stop, idx) => {
        if (idx > 0 && legs[idx - 1]) {
          const leg = legs[idx - 1];
          html += `
            <div class="route-connector-line">
              <span class="route-leg-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
                ${leg.distanceKm} km · ~${formatDurationHours(leg.timeHours)}
              </span>
            </div>
          `;
        }

        const etaLabel = idx === 0
          ? `Depart: ${addHoursToTimeString(departTimeStr, 0)}`
          : (legs[idx - 1] ? `ETA: ${legs[idx - 1].etaStr}` : '');

        html += `
          <div class="route-stop-card">
            <div class="route-stop-left">
              <div class="route-stop-num" style="${idx === 0 ? 'background: #16A34A;' : (idx === stops.length - 1 ? 'background: #DC2626;' : '')}">
                ${idx + 1}
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span class="route-stop-name">${escapeHtml(stop.name)}</span>
                  ${etaLabel ? `<span class="route-eta-pill">${escapeHtml(etaLabel)}</span>` : ''}
                </div>
                <div class="route-stop-notes">${escapeHtml(stop.stay_notes || (idx === 0 ? 'Starting Point' : (idx === stops.length - 1 ? 'Final Destination' : `Waypoint ${idx + 1}`)))}</div>
              </div>
            </div>
            <div>
              <button type="button" class="btn btn-sm btn-danger btn-remove-stop" data-id="${stop.id}" title="Remove Stop" style="padding: 4px 8px;">
                ${ICONS.trash}
              </button>
            </div>
          </div>
        `;
      });
      timelineEl.innerHTML = html;
    }
  }

  initOrUpdateRouteMap(stops);
}

/**
 * 8. Render Settings View & Unified Member Manager
 */
function renderSettingsView(state) {
  const nameInput = document.getElementById('input-trip-name');
  if (nameInput) nameInput.value = state.tripName || '';

  const currSelect = document.getElementById('select-currency');
  if (currSelect) currSelect.value = state.currency || '₹';

  const sheetInput = document.getElementById('input-google-sheet-url');
  if (sheetInput) sheetInput.value = state.settings?.googleSheetUrl || '';

  const countBadge = document.getElementById('settings-members-count-badge');
  if (countBadge) countBadge.textContent = (state.members || []).length;

  const travelersList = document.getElementById('settings-travelers-list');
  if (travelersList) {
    if (!state.members || state.members.length === 0) {
      travelersList.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; padding: 8px 0;">No friends added yet. Add a friend above!</div>`;
    } else {
      travelersList.innerHTML = state.members.map((m) => {
        const isRegistered = !!m.userId;
        const roleLabel = m.role === 'admin' ? 'Admin' : 'Traveler';
        const statusPill = isRegistered
          ? `<span style="font-size: 0.69rem; font-weight: 700; color: #059669; background: #D1FAE5; padding: 2px 8px; border-radius: 99px;">Joined Account</span>`
          : `<span style="font-size: 0.69rem; font-weight: 700; color: #0284C7; background: #E0F2FE; padding: 2px 8px; border-radius: 99px;">Ready to Claim via Link</span>`;

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; background: #FFFFFF; border: 1px solid var(--border-color); padding: 10px 14px; border-radius: 12px; gap: 8px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="avatar" style="background: ${m.color}; width: 34px; height: 34px; font-size: 0.85rem;">${escapeHtml(m.avatar)}</span>
              <div>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <strong style="font-size: 0.92rem; color: var(--text-primary);">${escapeHtml(m.name)}</strong>
                  <span style="font-size: 0.68rem; font-weight: 700; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1px 6px; border-radius: 4px;">${roleLabel}</span>
                </div>
                <div style="margin-top: 3px;">${statusPill}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button type="button" class="btn btn-sm btn-secondary btn-rename-member" data-id="${m.id}" data-name="${escapeHtml(m.name)}" style="padding: 5px 10px; font-size: 0.76rem;">
                Rename
              </button>
              ${m.role !== 'admin' ? `
                <button type="button" class="btn btn-sm btn-danger btn-remove-member" data-id="${m.id}" title="Remove ${escapeHtml(m.name)}" style="padding: 5px 8px;">
                  ${ICONS.trash}
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
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
  if (headerPill) headerPill.classList.remove(...classes);
  if (settingsBadge) settingsBadge.classList.remove(...classes);

  let label = 'Cloud Live';
  let badgeClass = 'synced';

  if (status === 'syncing') {
    label = 'Syncing...';
    badgeClass = 'syncing';
  } else if (status === 'error') {
    label = 'Reconnecting';
    badgeClass = 'error';
  } else if (status === 'synced' || lastSyncedAt) {
    label = 'Live Sync';
    badgeClass = 'synced';
  }

  if (headerPill) headerPill.classList.add(badgeClass);
  if (headerText) headerText.textContent = label;
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
    <span class="avatar" style="background:${m.color}; margin-right: 6px;">${escapeHtml(m.avatar)}</span>
    ${escapeHtml(m.name)}'s Report
  `;

  let netHtml = '';
  if (m.netGroupBalance > 0.05) {
    netHtml = `<span style="color: var(--color-green); font-size: 1.25rem; font-weight: 800;">Gets back +${curr}${m.netGroupBalance.toLocaleString()}</span>`;
  } else if (m.netGroupBalance < -0.05) {
    netHtml = `<span style="color: var(--color-red); font-size: 1.25rem; font-weight: 800;">Owes ${curr}${Math.abs(m.netGroupBalance).toLocaleString()}</span>`;
  } else {
    netHtml = `<span style="color: var(--text-secondary); font-size: 1.25rem; font-weight: 800;">All Settled (${curr}0)</span>`;
  }

  const toPay = summary.settlementTransfers.filter(t => t.fromId === memberId);
  const toReceive = summary.settlementTransfers.filter(t => t.toId === memberId);

  let settlementsHtml = '';
  if (toPay.length > 0) {
    settlementsHtml += `<div style="margin-top: 10px; padding: 10px; background: var(--color-red-light); border-radius: var(--radius-sm); border: 1px solid var(--color-red-border);">
      <div style="font-weight: 700; color: var(--color-red); margin-bottom: 4px;">Pending Payments:</div>
      ${toPay.map(t => `<div>Pay <b>${curr}${t.amount}</b> to <b>${escapeHtml(t.toName)}</b></div>`).join('')}
    </div>`;
  }
  if (toReceive.length > 0) {
    settlementsHtml += `<div style="margin-top: 10px; padding: 10px; background: var(--color-green-light); border-radius: var(--radius-sm); border: 1px solid var(--color-green-border);">
      <div style="font-weight: 700; color: var(--color-green); margin-bottom: 4px;">Pending Collections:</div>
      ${toReceive.map(t => `<div>Collect <b>${curr}${t.amount}</b> from <b>${escapeHtml(t.fromName)}</b></div>`).join('')}
    </div>`;
  }

  const body = document.getElementById('modal-member-body');
  body.innerHTML = `
    <div style="text-align: center; padding: 16px; background: var(--bg-surface); border-radius: var(--radius-md); margin-bottom: 16px;">
      <div style="font-size: 0.78rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Net Balance</div>
      <div style="margin: 4px 0;">${netHtml}</div>
      <div style="font-size: 0.82rem; color: var(--text-secondary);">Total Out of Pocket: <b>${curr}${m.totalOutPocket.toLocaleString()}</b></div>
      ${settlementsHtml}
    </div>

    <div class="card" style="padding: 12px; margin-bottom: 16px;">
      <div class="member-metric-row"><span>Total Paid for Group:</span> <b>${curr}${m.paidForGroup.toLocaleString()}</b></div>
      <div class="member-metric-row"><span>Share of Group Expenses:</span> <b>${curr}${m.shareOfGroup.toLocaleString()}</b></div>
      <div class="member-metric-row"><span>Personal Solo Expenses:</span> <b>${curr}${m.personalSpend.toLocaleString()}</b></div>
    </div>

    <h4 style="font-size: 0.88rem; margin-bottom: 8px;">Bills Paid by ${escapeHtml(m.name)} (${m.paidTransactions.length})</h4>
    <div style="margin-bottom: 16px;">
      ${m.paidTransactions.length === 0 ? `<div style="color: var(--text-muted); font-size: 0.82rem;">None</div>` :
        m.paidTransactions.map(e => `
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color); font-size: 0.84rem;">
            <span>${escapeHtml(e.title)} (${escapeHtml(e.date || '')})</span>
            <b>${curr}${Number(e.amount).toLocaleString()}</b>
          </div>
        `).join('')}
    </div>

    <h4 style="font-size: 0.88rem; margin-bottom: 8px;">Group Bills Shared In (${m.sharedTransactions.length})</h4>
    <div style="margin-bottom: 16px;">
      ${m.sharedTransactions.length === 0 ? `<div style="color: var(--text-muted); font-size: 0.82rem;">None</div>` :
        m.sharedTransactions.map(e => `
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color); font-size: 0.84rem;">
            <span>${escapeHtml(e.title)} (Total ${curr}${e.amount})</span>
            <span style="color: var(--color-red);">Share: ${curr}${Math.round((e.myShare || 0) * 100) / 100}</span>
          </div>
        `).join('')}
    </div>
  `;

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

  isPersonalExpenseMode = isEdit ? !!expenseToEdit.isPersonal : false;
  updateExpenseModeToggleUI();

  const payerSelect = document.getElementById('select-exp-payer');
  payerSelect.innerHTML = '';

  if (!isPersonalExpenseMode) {
    const kittyOpt = document.createElement('option');
    kittyOpt.value = 'KITTY';
    kittyOpt.textContent = `Group Kitty (Available: ${state.currency}${state.kitty?.balance || 0})`;
    payerSelect.appendChild(kittyOpt);
  }

  (state.members || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    payerSelect.appendChild(opt);
  });

  if (isEdit) {
    payerSelect.value = expenseToEdit.payerId;
  } else if (stateManager.currentMember && state.members.some(m => m.id === stateManager.currentMember.id)) {
    payerSelect.value = stateManager.currentMember.id;
  } else if (state.members[0]) {
    payerSelect.value = state.members[0].id;
  }

  if (isEdit && expenseToEdit.splitWith) {
    selectedSplitMembers = new Set(expenseToEdit.splitWith);
  } else {
    selectedSplitMembers = new Set((state.members || []).map(m => m.id));
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

  const state = stateManager.state;
  const payerSelect = document.getElementById('select-exp-payer');
  const currentVal = payerSelect.value;
  payerSelect.innerHTML = '';

  if (!isPersonalExpenseMode) {
    const kittyOpt = document.createElement('option');
    kittyOpt.value = 'KITTY';
    kittyOpt.textContent = `Group Kitty (Available: ${state.currency}${state.kitty?.balance || 0})`;
    payerSelect.appendChild(kittyOpt);
  }

  (state.members || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    payerSelect.appendChild(opt);
  });

  if (currentVal && payerSelect.querySelector(`option[value="${currentVal}"]`)) {
    payerSelect.value = currentVal;
  } else if (stateManager.currentMember) {
    payerSelect.value = stateManager.currentMember.id;
  } else if (state.members[0]) {
    payerSelect.value = state.members[0].id;
  }
  updateSplitPreview();
}

function renderSplitCheckboxes() {
  const container = document.getElementById('split-members-checkboxes');
  const state = stateManager.state;
  if (!container) return;

  container.innerHTML = (state.members || []).map(m => {
    const checked = selectedSplitMembers.has(m.id);
    return `
      <label class="split-member-checkbox-card ${checked ? 'selected' : ''}">
        <input type="checkbox" class="cb-split-member" value="${m.id}" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(m.name)}</span>
      </label>
    `;
  }).join('');

  const countEl = document.getElementById('split-selected-count');
  if (countEl) countEl.textContent = selectedSplitMembers.size;
  updateSplitPreview();
}

export function updateSplitPreview() {
  const amount = parseFloat(document.getElementById('input-exp-amount')?.value) || 0;
  const count = selectedSplitMembers.size;
  const curr = stateManager.state.currency || '₹';
  const preview = document.getElementById('split-per-person-preview');
  if (!preview) return;

  if (count === 0) {
    preview.textContent = 'Select at least 1 person';
    preview.style.color = 'var(--color-red)';
  } else {
    const perPerson = Math.round((amount / count) * 100) / 100;
    preview.textContent = `${count} ${count === 1 ? 'person' : 'people'} · ${curr}${perPerson.toLocaleString()} each`;
    preview.style.color = 'var(--brand-blue)';
  }
}

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

export function setActiveTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    view.style.display = view.id === `view-${tabName}` ? 'block' : 'none';
  });

  if (tabName === 'route') {
    invalidateRouteMapSize();
    renderRouteView(stateManager.state);
  } else if (tabName === 'chat') {
    renderChatView(stateManager.state);
    const chatBox = document.getElementById('chat-messages-box');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
  }

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
  selectedSplitMembers = new Set((stateManager.state.members || []).map(m => m.id));
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
