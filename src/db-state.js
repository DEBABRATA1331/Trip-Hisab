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
    this.currentMember = null;  // the trip_member record for current user
    this.state = {
      tripName: 'Loading...',
      currency: '₹',
      budget: 0,
      members: [],
      expenses: [],
      kitty: { balance: 0, history: [] },
      settlements: [],
      notes: [],
      messages: [],
      destinations: [],
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

      // Map DB format → app format
      const mappedMembers = this._mapMembers(members);
      let foundMember = mappedMembers.find(m => m.userId === this.currentUser.id);
      if (!foundMember) {
        foundMember = {
          id: this.currentUser.id,
          userId: this.currentUser.id,
          name: this.currentUser.user_metadata?.display_name || this.currentUser.email?.split('@')[0] || 'Admin',
          avatar: (this.currentUser.user_metadata?.display_name || this.currentUser.email || 'A').charAt(0).toUpperCase(),
          role: (trip.created_by === this.currentUser.id) ? 'admin' : 'member',
          color: '#0066FF'
        };
        mappedMembers.unshift(foundMember);
      }
      this.currentMember = foundMember;

      this.state = {
        tripId: trip.id,
        tripName: trip.name,
        currency: trip.currency || '₹',
        budget: trip.budget || 0,
        inviteCode: trip.invite_code,
        createdBy: trip.created_by,
        members: mappedMembers,
        expenses: this._mapExpenses(expenses, mappedMembers),
        kitty: this._buildKittyState(kittyTx),
        settlements: this._mapSettlements(settlements, mappedMembers),
        notes: this._mapNotes(notes),
        messages: messages || [],
        destinations: destinations || [],
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

  async removeMember(memberId) {
    if (!memberId) return;
    await dbDeleteMember(memberId);
    await this.loadAll();
  }

  // ─── CHAT MESSAGES ────────────────────────────────────────────────────────

  async sendMessage(text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;
    await sendTripMessage({
      tripId: this.tripId,
      message: cleanText,
      senderName: this.currentMember?.name || 'Traveler',
      senderColor: this.currentMember?.color || '#0066FF'
    });
    await this.loadAll();
  }

  // ─── ROUTE & DESTINATIONS ─────────────────────────────────────────────────

  async addDestination({ name, lat, lng, stayNotes, estDuration }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const currentCount = this.state.destinations?.length || 0;
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

