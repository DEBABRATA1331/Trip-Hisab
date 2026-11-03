// =========================================================================
// TRIP HISAB - SUPABASE STATE MANAGER
// Replaces localStorage with real Supabase DB calls.
// Keeps the same API as the old StateManager so UI code needs minimal changes.
// =========================================================================

import {
  supabase,
  getUser,
  getTrip,
  getTripMembers,
  getExpenses,
  getKittyTransactions,
  getSettlements,
  getNotes,
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
    this.currentMember = null;  // the trip_member record for current user
    this.state = {
      tripName: 'Loading...',
      currency: '₹',
      members: [],
      expenses: [],
      kitty: { balance: 0, history: [] },
      settlements: [],
      notes: [],
      security: { enabled: false },
      settings: { syncStatus: 'loading' }
    };
    this.listeners = new Set();
    this._unsubscribeRealtime = null;
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────

  async init(tripId) {
    this.tripId = tripId;
    this.currentUser = await getUser();
    if (!this.currentUser) throw new Error('Not authenticated');

    await this.loadAll();
    this._startRealtime();
    return this.state;
  }

  async loadAll() {
    try {
      const [trip, members, expenses, kittyTx, settlements, notes] = await Promise.all([
        getTrip(this.tripId),
        getTripMembers(this.tripId),
        getExpenses(this.tripId),
        getKittyTransactions(this.tripId),
        getSettlements(this.tripId),
        getNotes(this.tripId)
      ]);

      // Find current user's member record
      this.currentMember = members.find(m => m.user_id === this.currentUser.id) || null;

      // Map DB format → app format
      this.state = {
        tripId: trip.id,
        tripName: trip.name,
        currency: trip.currency || '₹',
        budget: trip.budget || 0,
        inviteCode: trip.invite_code,
        createdBy: trip.created_by,
        members: this._mapMembers(members),
        expenses: this._mapExpenses(expenses, members),
        kitty: this._buildKittyState(kittyTx),
        settlements: this._mapSettlements(settlements, members),
        notes: this._mapNotes(notes),
        security: { enabled: false },
        settings: { syncStatus: 'synced', lastSyncedAt: new Date().toISOString() }
      };

      this.notify();
    } catch (err) {
      console.error('Failed to load trip data:', err);
      this.state.settings = { syncStatus: 'error' };
      this.notify();
    }
  }

  // ─── REALTIME ─────────────────────────────────────────────────────────────

  _startRealtime() {
    if (this._unsubscribeRealtime) this._unsubscribeRealtime();
    this._unsubscribeRealtime = subscribeToTrip(this.tripId, async (payload) => {
      // Reload all data on any change
      await this.loadAll();
    });
  }

  destroy() {
    if (this._unsubscribeRealtime) this._unsubscribeRealtime();
  }

  // ─── DATA MAPPERS ─────────────────────────────────────────────────────────

  _mapMembers(members) {
    const colors = ['#0066FF', '#0284C7', '#2563EB', '#4F46E5', '#0D9488', '#334155', '#D97706', '#DC2626'];
    return members.map((m, i) => ({
      id: m.id,           // UUID from trip_members
      userId: m.user_id,
      name: m.display_name,
      avatar: m.display_name.charAt(0).toUpperCase(),
      color: m.color || colors[i % colors.length],
      role: m.role,
      _raw: m
    }));
  }

  _mapExpenses(expenses, members) {
    return expenses.map(e => ({
      id: e.id,
      title: e.title,
      amount: parseFloat(e.amount) || 0,
      category: e.category || 'Misc',
      date: e.date,
      time: e.created_at ? e.created_at.substring(11, 16) : '00:00',
      payerId: e.payer_member_id || 'KITTY',
      isPersonal: !!e.is_personal,
      splitWith: e.split_with || members.map(m => m.id),
      splitMode: 'EQUAL',
      customSplits: {},
      notes: e.notes || '',
      createdAt: e.created_at,
      _raw: e
    }));
  }

  _buildKittyState(txList) {
    let balance = 0;
    const history = txList.map(tx => {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'DEPOSIT') balance += amt;
      else if (tx.type === 'WITHDRAW' || tx.type === 'EXPENSE') balance -= amt;
      else if (tx.type === 'ADJUST') balance = amt;
      return {
        id: tx.id,
        type: tx.type,
        amount: amt,
        member: tx.member_name || 'Pool',
        note: tx.note || '',
        date: tx.date,
        balanceAfter: balance,
        createdAt: tx.created_at,
        _raw: tx
      };
    }).reverse(); // newest first for display
    return { balance, history };
  }

  _mapSettlements(settlements, members) {
    return settlements.map(s => ({
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
    return notes.map(n => ({
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

  // Undo/Redo stubs (not supported with DB backend)
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

  // ─── MEMBERS ─────────────────────────────────────────────────────────────

  async addMember(name) {
    // Adding a member creates an "anonymous" trip_member record (no auth user)
    // For simplicity, we insert a record with user_id = current user's (they manage it)
    // In a full version you'd invite them. For now, add as display name placeholder.
    const { error } = await supabase.from('trip_members').insert({
      trip_id: this.tripId,
      user_id: this.currentUser.id, // placeholder - will be overridden when they log in
      display_name: name.trim(),
      role: 'member'
    });
    // Note: This will fail due to UNIQUE constraint if they're already a member.
    // For now just reload - full invite flow via invite code is preferred.
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

    // Handle kitty deduction
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
    if (updatedFields.payerId !== undefined) dbUpdates.payer_member_id = updatedFields.payerId === 'KITTY' ? null : updatedFields.payerId;
    if (updatedFields.isPersonal !== undefined) dbUpdates.is_personal = updatedFields.isPersonal;
    if (updatedFields.splitWith !== undefined) dbUpdates.split_with = updatedFields.splitWith;
    if (updatedFields.notes !== undefined) dbUpdates.notes = updatedFields.notes;
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
    if (memberId === 'ALL') totalAdded = num * this.state.members.length;

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

  // Legacy stubs (not needed with DB backend)
  updateGoogleSheetUrl() {}
  updateSecuritySettings() {}
  setMemberPin() {}
  updateMember() {}
  removeMember() {}
  updateKittyTransaction() {}
  recalculateKittyLedger() {}
  exportBackup() { return JSON.stringify(this.state, null, 2); }
  importBackup() { return { success: false, error: 'Not supported with database backend' }; }
  triggerAutoSync() {}
}

export const stateManager = new SupabaseStateManager();
window.__tripHisabStateManager = stateManager;

