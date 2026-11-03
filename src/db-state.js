// =========================================================================
// TRIP HISAB - SUPABASE STATE MANAGER
// Replaces localStorage with real Supabase DB calls + automatic fallback.
// =========================================================================

import {
  supabase,
  getUser,
  getTrip,
  ensureUserJoinedTrip,
  getTripMembers,
  addPlaceholderMember,
  renameMember as dbRenameMember,
  deleteTripMember as dbDeleteMember,
  getExpenses,
  getKittyTransactions,
  getSettlements,
  getNotes,
  getTripMessages,
  sendTripMessage,
  getTripDestinations,
  addTripDestination as dbAddDestination,
  deleteTripDestination as dbDeleteDestination,
  addExpense as dbAddExpense,
  updateExpense as dbUpdateExpense,
  deleteExpense as dbDeleteExpense,
  addKittyTransaction as dbAddKittyTx,
  deleteKittyTransaction as dbDeleteKittyTx,
  addSettlement as dbAddSettlement,
  deleteSettlement as dbDeleteSettlement,
  addNote as dbAddNote,
  updateNote as dbUpdateNote,
  deleteNote as dbDeleteNote,
  updateTrip as dbUpdateTrip,
  subscribeToTrip
} from './supabase.js';

class SupabaseStateManager {
  constructor() {
    this.tripId = null;
    this.currentUser = null;
    this.currentMember = null;
    this.state = {
      tripId: null,
      tripName: 'Loading...',
      currency: '₹',
      budget: 0,
      inviteCode: '',
      members: [],
      expenses: [],
      kitty: { balance: 0, history: [] },
      settlements: [],
      notes: [],
      messages: [],
      destinations: [],
      security: { enabled: false },
      settings: { syncStatus: 'loading', googleSheetUrl: '' }
    };
    this.listeners = new Set();
    this._unsubscribeRealtime = null;
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────

  async init(tripId) {
    this.tripId = tripId;
    this.currentUser = await getUser();
    if (!this.currentUser) throw new Error('Not authenticated');

    // Ensure user opening a shared link (?trip=...) is enrolled in trip_members first
    try {
      await ensureUserJoinedTrip(this.tripId);
    } catch (e) {
      console.warn('Auto-join check notice:', e);
    }

    await this.loadAll();
    this._startRealtime();
    return this.state;
  }

  async loadAll() {
    try {
      const [trip, members, expenses, kittyTx, settlements, notes, messages, destinations] = await Promise.all([
        getTrip(this.tripId),
        getTripMembers(this.tripId),
        getExpenses(this.tripId),
        getKittyTransactions(this.tripId),
        getSettlements(this.tripId),
        getNotes(this.tripId),
        getTripMessages(this.tripId),
        getTripDestinations(this.tripId)
      ]);

      const mappedMembers = this._mapMembers(members);
      let foundMember = mappedMembers.find(m => m.userId === this.currentUser.id);
      if (!foundMember) {
        const defaultName = this.currentUser.user_metadata?.display_name || this.currentUser.email?.split('@')[0] || 'Traveler';
        foundMember = {
          id: this.currentUser.id,
          userId: this.currentUser.id,
          name: defaultName,
          avatar: defaultName.charAt(0).toUpperCase(),
          role: (trip.created_by === this.currentUser.id) ? 'admin' : 'member',
          color: '#0066FF'
        };
        mappedMembers.unshift(foundMember);
      }
      this.currentMember = foundMember;

      // Keep local Google Sheet URL if configured for this trip
      const savedSheetUrl = localStorage.getItem(`upmark_sheet_${this.tripId}`) || '';

      this.state = {
        tripId: trip.id,
        tripName: trip.name,
        currency: trip.currency || '₹',
        budget: trip.budget || 0,
        inviteCode: trip.invite_code,
        createdBy: trip.created_by,
        members: mappedMembers,
        expenses: this._mapExpenses(expenses, mappedMembers),
        kitty: this._buildKittyState(kittyTx, mappedMembers),
        settlements: this._mapSettlements(settlements, mappedMembers),
        notes: this._mapNotes(notes),
        messages: messages || [],
        destinations: destinations || [],
        security: { enabled: false },
        settings: {
          syncStatus: 'synced',
          googleSheetUrl: savedSheetUrl,
          lastSyncedAt: new Date().toISOString()
        }
      };

      this.notify();
    } catch (err) {
      console.error('Failed to load trip data:', err);
      this.state.settings = { ...this.state.settings, syncStatus: 'error' };
      this.notify();
      throw err;
    }
  }

  // ─── REALTIME ─────────────────────────────────────────────────────────────

  _startRealtime() {
    if (this._unsubscribeRealtime) this._unsubscribeRealtime();
    this._unsubscribeRealtime = subscribeToTrip(this.tripId, async () => {
      await this.loadAll();
    });
  }

  destroy() {
    if (this._unsubscribeRealtime) this._unsubscribeRealtime();
  }

  // ─── DATA MAPPERS ─────────────────────────────────────────────────────────

  _mapMembers(members) {
    const colors = ['#0066FF', '#0284C7', '#2563EB', '#4F46E5', '#0D9488', '#334155', '#D97706', '#DC2626'];
    return (members || []).map((m, i) => ({
      id: m.id,
      userId: m.user_id,
      name: m.display_name || 'Traveler',
      avatar: (m.display_name || 'T').charAt(0).toUpperCase(),
      color: m.color || colors[i % colors.length],
      role: m.role || 'member',
      _raw: m
    }));
  }

  _mapExpenses(expenses, members) {
    return (expenses || []).map(e => {
      let payerId = e.payer_member_id || 'KITTY';
      let rawNotes = e.notes || '';
      const payerMatch = rawNotes.match(/^\[PAYER:([^\]]+)\]\s*/);
      if (payerMatch) {
        payerId = payerMatch[1];
        rawNotes = rawNotes.replace(/^\[PAYER:([^\]]+)\]\s*/, '');
      }
      return {
        id: e.id,
        title: e.title,
        amount: parseFloat(e.amount) || 0,
        category: e.category || 'Misc',
        date: e.date,
        time: e.created_at ? e.created_at.substring(11, 16) : '00:00',
        payerId,
        isPersonal: !!e.is_personal,
        splitWith: (e.split_with && e.split_with.length > 0) ? e.split_with : members.map(m => m.id),
        splitMode: 'EQUAL',
        customSplits: {},
        notes: rawNotes,
        createdAt: e.created_at,
        _raw: e
      };
    });
  }

  _buildKittyState(txList, members = []) {
    let balance = 0;
    const history = (txList || []).map(tx => {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'DEPOSIT') balance += amt;
      else if (tx.type === 'WITHDRAW' || tx.type === 'EXPENSE') balance -= amt;
      else if (tx.type === 'ADJUST') balance = amt;

      const matchedMember = members.find(m => m.name.toLowerCase() === String(tx.member_name || '').toLowerCase());
      const isAll = String(tx.member_name || '').toLowerCase().includes('all');

      return {
        id: tx.id,
        type: tx.type,
        amount: amt,
        member: tx.member_name || 'Pool',
        memberId: isAll ? 'ALL' : (matchedMember ? matchedMember.id : 'POOL'),
        note: tx.note || '',
        date: tx.date,
        balanceAfter: balance,
        createdAt: tx.created_at,
        _raw: tx
      };
    }).reverse();
    return { balance, history };
  }

  _mapSettlements(settlements) {
    return (settlements || []).map(s => ({
      id: s.id,
      from: s.from_member_id,
      to: s.to_member_id,
      amount: parseFloat(s.amount) || 0,
      note: s.note || '',
      date: s.created_at?.slice(0, 10),
      settled: true,
      settledAt: s.created_at,
      _raw: s
    }));
  }

  _mapNotes(notes) {
    return (notes || []).map(n => ({
      id: n.id,
      type: n.type || 'note',
      title: n.title,
      content: n.content || '',
      updatedAt: n.created_at,
      _raw: n
    }));
  }

  // ─── SUBSCRIBE/NOTIFY ─────────────────────────────────────────────────────

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(eventData = {}) {
    for (const listener of this.listeners) {
      try { listener(this.state, eventData); } catch (e) { console.error('Listener error:', e); }
    }
  }

  canUndo() { return false; }
  canRedo() { return false; }
  getUndoActionName() { return null; }
  undo() { return false; }
  redo() { return false; }

  // ─── TRIP SETTINGS ────────────────────────────────────────────────────────

  async updateTripInfo({ name, currency }) {
    const updates = {};
    if (name !== undefined) updates.name = name.trim() || 'My Trip';
    if (currency !== undefined) updates.currency = currency.trim() || '₹';
    await dbUpdateTrip(this.tripId, updates);
    await this.loadAll();
  }

  updateGoogleSheetUrl(url) {
    const clean = (url || '').trim();
    if (this.tripId) {
      localStorage.setItem(`upmark_sheet_${this.tripId}`, clean);
    }
    this.state.settings.googleSheetUrl = clean;
    this.notify();
  }

  // ─── MEMBERS ─────────────────────────────────────────────────────────────

  async addMember(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    await addPlaceholderMember(this.tripId, cleanName);
    await this.loadAll();
  }

  async renameMember(memberId, newName) {
    const cleanName = String(newName || '').trim();
    if (!cleanName) return;
    await dbRenameMember(memberId, cleanName);
    await this.loadAll();
  }

  async updateMember(memberId, { name }) {
    if (name) await this.renameMember(memberId, name);
  }

  async removeMember(memberId) {
    if (!memberId) return;
    await dbDeleteMember(memberId);
    await this.loadAll();
  }

  // ─── CHAT MESSAGES ────────────────────────────────────────────────────────

  async sendMessage(text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;
    const senderName = this.currentMember?.name || this.currentUser?.user_metadata?.display_name || 'Traveler';
    const senderColor = this.currentMember?.color || '#0066FF';

    // Optimistic UI update so message renders immediately on mobile/desktop
    const optimisticMsg = {
      id: 'temp_' + Date.now(),
      trip_id: this.tripId,
      user_id: this.currentUser?.id,
      sender_name: senderName,
      sender_color: senderColor,
      message: cleanText,
      created_at: new Date().toISOString()
    };
    this.state.messages = [...(this.state.messages || []), optimisticMsg];
    this.notify();

    await sendTripMessage({
      tripId: this.tripId,
      message: cleanText,
      senderName,
      senderColor
    });
    await this.loadAll();
  }

  // ─── ROUTE & DESTINATIONS ─────────────────────────────────────────────────

  async addDestination({ name, lat, lng, stayNotes, estDuration }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const currentCount = this.state.destinations?.length || 0;

    // Optimistic UI update
    const optimisticStop = {
      id: 'temp_stop_' + Date.now(),
      trip_id: this.tripId,
      name: cleanName,
      lat: lat || 0,
      lng: lng || 0,
      stop_order: currentCount + 1,
      stay_notes: stayNotes || '',
      est_duration: estDuration || ''
    };
    this.state.destinations = [...(this.state.destinations || []), optimisticStop];
    this.notify();

    await dbAddDestination({
      tripId: this.tripId,
      name: cleanName,
      lat: lat || 0,
      lng: lng || 0,
      stopOrder: currentCount + 1,
      stayNotes: stayNotes || '',
      estDuration: estDuration || ''
    });
    await this.loadAll();
  }

  async removeDestination(id) {
    if (!id) return;
    this.state.destinations = (this.state.destinations || []).filter(d => d.id !== id);
    this.notify();
    await dbDeleteDestination(id);
    await this.loadAll();
  }

  // ─── EXPENSES ─────────────────────────────────────────────────────────────

  async addExpense(expenseData) {
    await dbAddExpense({
      tripId: this.tripId,
      title: expenseData.title,
      amount: parseFloat(expenseData.amount) || 0,
      category: expenseData.category || 'Misc',
      date: expenseData.date || new Date().toISOString().slice(0, 10),
      payerMemberId: expenseData.payerId === 'KITTY' ? null : expenseData.payerId,
      isPersonal: !!expenseData.isPersonal,
      splitWith: expenseData.splitWith || this.state.members.map(m => m.id),
      notes: expenseData.notes || ''
    });

    if (expenseData.payerId === 'KITTY' && !expenseData.isPersonal) {
      await dbAddKittyTx({
        tripId: this.tripId,
        type: 'EXPENSE',
        amount: parseFloat(expenseData.amount) || 0,
        memberName: 'Group Kitty',
        note: `Paid for: ${expenseData.title}`,
        date: expenseData.date || new Date().toISOString().slice(0, 10)
      });
    }

    await this.loadAll();
  }

  async updateExpense(id, updatedFields) {
    const dbUpdates = {};
    if (updatedFields.title !== undefined) dbUpdates.title = updatedFields.title;
    if (updatedFields.amount !== undefined) dbUpdates.amount = parseFloat(updatedFields.amount);
    if (updatedFields.category !== undefined) dbUpdates.category = updatedFields.category;
    if (updatedFields.date !== undefined) dbUpdates.date = updatedFields.date;
    if (updatedFields.payerId !== undefined) {
      const isPlanned = String(updatedFields.payerId).startsWith('planned_');
      dbUpdates.payer_member_id = (updatedFields.payerId === 'KITTY' || isPlanned) ? null : updatedFields.payerId;
      if (isPlanned) {
        dbUpdates.notes = `[PAYER:${updatedFields.payerId}] ${updatedFields.notes || ''}`.trim();
      } else if (updatedFields.notes !== undefined) {
        dbUpdates.notes = updatedFields.notes;
      }
    } else if (updatedFields.notes !== undefined) {
      dbUpdates.notes = updatedFields.notes;
    }
    if (updatedFields.isPersonal !== undefined) dbUpdates.is_personal = updatedFields.isPersonal;
    if (updatedFields.splitWith !== undefined) dbUpdates.split_with = updatedFields.splitWith;

    await dbUpdateExpense(id, dbUpdates);
    await this.loadAll();
  }

  async deleteExpense(id) {
    await dbDeleteExpense(id);
    await this.loadAll();
  }

  // ─── KITTY ────────────────────────────────────────────────────────────────

  async addKittyDeposit({ amount, memberId, note, date }) {
    const num = parseFloat(amount) || 0;
    if (num <= 0) return;
    const member = this.state.members.find(m => m.id === memberId);
    const memberName = member ? member.name : (memberId === 'ALL' ? `All Members` : 'Pool');
    let totalAdded = num;
    if (memberId === 'ALL') totalAdded = num * (this.state.members.length || 1);

    await dbAddKittyTx({
      tripId: this.tripId,
      type: 'DEPOSIT',
      amount: totalAdded,
      memberName,
      note: note || 'Kitty Deposit',
      date: date || new Date().toISOString().slice(0, 10)
    });
    await this.loadAll();
  }

  async withdrawKitty({ amount, memberId, note, date }) {
    const num = parseFloat(amount) || 0;
    if (num <= 0) return;
    const member = this.state.members.find(m => m.id === memberId);
    const memberName = member ? member.name : 'Emergency / Cash';

    await dbAddKittyTx({
      tripId: this.tripId,
      type: 'WITHDRAW',
      amount: num,
      memberName,
      note: note || 'Cash withdrawn',
      date: date || new Date().toISOString().slice(0, 10)
    });
    await this.loadAll();
  }

  async modifyKittyBalance({ newBalance, reason, date }) {
    const num = parseFloat(newBalance) || 0;
    await dbAddKittyTx({
      tripId: this.tripId,
      type: 'ADJUST',
      amount: num,
      memberName: 'Manual Adjust',
      note: reason || 'Balance adjusted',
      date: date || new Date().toISOString().slice(0, 10)
    });
    await this.loadAll();
  }

  async deleteKittyTransaction(id) {
    await dbDeleteKittyTx(id);
    await this.loadAll();
  }

  // ─── SETTLEMENTS ─────────────────────────────────────────────────────────

  async recordSettlement({ from, to, amount, note }) {
    await dbAddSettlement({
      tripId: this.tripId,
      fromMemberId: from,
      toMemberId: to,
      amount: parseFloat(amount) || 0,
      note: note || 'Direct payment / UPI settled'
    });
    await this.loadAll();
  }

  async deleteSettlement(id) {
    await dbDeleteSettlement(id);
    await this.loadAll();
  }

  // ─── NOTES ────────────────────────────────────────────────────────────────

  async addNote({ type, title, content }) {
    await dbAddNote({ tripId: this.tripId, type, title, content });
    await this.loadAll();
  }

  async updateNote(id, updates) {
    await dbUpdateNote(id, updates);
    await this.loadAll();
  }

  async deleteNote(id) {
    await dbDeleteNote(id);
    await this.loadAll();
  }

  // Legacy stubs
  updateSecuritySettings() {}
  setMemberPin() {}
  updateKittyTransaction() {}
  recalculateKittyLedger() {}
  exportBackup() { return JSON.stringify(this.state, null, 2); }
  importBackup() { return { success: false, error: 'Managed via live cloud database' }; }
  triggerAutoSync() {}
}

export const stateManager = new SupabaseStateManager();
window.__tripHisabStateManager = stateManager;
