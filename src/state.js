// =========================================================================
// TRIP HISAB - STATE MANAGEMENT & UNDO/REDO ENGINE
// =========================================================================

const STORAGE_KEY = 'TRIP_HISAB_DATA_V2';
const MAX_UNDO_STACK = 40;

const DEFAULT_MEMBERS = [
  { id: 'm1', name: 'Friend 1', avatar: '1', color: '#0066FF' },
  { id: 'm2', name: 'Friend 2', avatar: '2', color: '#0284C7' },
  { id: 'm3', name: 'Friend 3', avatar: '3', color: '#2563EB' },
  { id: 'm4', name: 'Friend 4', avatar: '4', color: '#4F46E5' },
  { id: 'm5', name: 'Friend 5', avatar: '5', color: '#0D9488' },
  { id: 'm6', name: 'Friend 6', avatar: '6', color: '#334155' }
];

const INITIAL_STATE = {
  tripName: 'Trip 2026',
  currency: '₹',
  members: DEFAULT_MEMBERS,
  expenses: [],
  kitty: {
    balance: 0,
    history: []
  },
  settlements: [],
  notes: [],
  settings: {
    googleSheetUrl: '',
    autoSync: true,
    lastSyncedAt: null,
    syncStatus: 'offline' // 'offline' | 'idle' | 'syncing' | 'synced' | 'error'
  }
};

class StateManager {
  constructor() {
    this.state = this.loadInitialState();
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.syncTimeout = null;
  }

  loadInitialState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Guarantee backwards compatibility and safety
        return {
          ...INITIAL_STATE,
          ...parsed,
          members: parsed.members && parsed.members.length ? parsed.members : DEFAULT_MEMBERS,
          expenses: parsed.expenses || [],
          kitty: parsed.kitty || { balance: 0, history: [] },
          settlements: parsed.settlements || [],
          notes: parsed.notes || [],
          settings: { ...INITIAL_STATE.settings, ...(parsed.settings || {}) }
        };
      }
    } catch (e) {
      console.warn('Failed to load local state, using initial defaults', e);
    }
    return JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('LocalStorage save error:', e);
    }
    this.notify();
    this.triggerAutoSync();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(eventData = {}) {
    for (const listener of this.listeners) {
      try {
        listener(this.state, eventData);
      } catch (e) {
        console.error('Listener error:', e);
      }
    }
  }

  // --- Snapshot & Undo / Redo engine ---
  recordAction(actionName = 'Change') {
    const snapshot = JSON.stringify(this.state);
    this.undoStack.push({ name: actionName, snapshot });
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
    // Any new action clears the redo branch
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  getUndoActionName() {
    if (!this.canUndo()) return null;
    return this.undoStack[this.undoStack.length - 1].name;
  }

  undo() {
    if (!this.canUndo()) return false;
    const currentSnapshot = JSON.stringify(this.state);
    const lastAction = this.undoStack.pop();
    this.redoStack.push({ name: lastAction.name, snapshot: currentSnapshot });
    
    this.state = JSON.parse(lastAction.snapshot);
    this.save();
    this.notify({ type: 'undo', action: lastAction.name });
    return lastAction.name;
  }

  redo() {
    if (!this.canRedo()) return false;
    const currentSnapshot = JSON.stringify(this.state);
    const nextAction = this.redoStack.pop();
    this.undoStack.push({ name: nextAction.name, snapshot: currentSnapshot });

    this.state = JSON.parse(nextAction.snapshot);
    this.save();
    this.notify({ type: 'redo', action: nextAction.name });
    return nextAction.name;
  }

  // --- Trip / Settings Mutations ---
  updateTripInfo({ name, currency }) {
    this.recordAction('Update Trip Info');
    if (name !== undefined) this.state.tripName = name.trim() || 'My Trip';
    if (currency !== undefined) this.state.currency = currency.trim() || '₹';
    this.save();
  }

  updateGoogleSheetUrl(url) {
    this.recordAction('Update Google Sheet Link');
    this.state.settings.googleSheetUrl = (url || '').trim();
    this.save();
  }

  // --- Members Mutations ---
  updateMember(memberId, { name, avatar, color }) {
    this.recordAction(`Edit member ${name || memberId}`);
    const member = this.state.members.find(m => m.id === memberId);
    if (member) {
      if (name) {
        member.name = name.trim();
        member.avatar = name.trim().charAt(0).toUpperCase();
      }
      if (avatar) member.avatar = avatar;
      if (color) member.color = color;
      this.save();
    }
  }

  addMember(name) {
    if (!name || !name.trim()) return;
    this.recordAction(`Add member ${name}`);
    const id = 'm' + (Date.now() % 100000);
    const colors = ['#0066FF', '#0284C7', '#2563EB', '#4F46E5', '#0D9488', '#334155', '#475569'];
    const chosenColor = colors[this.state.members.length % colors.length];
    this.state.members.push({
      id,
      name: name.trim(),
      avatar: name.trim().charAt(0).toUpperCase(),
      color: chosenColor
    });
    this.save();
  }

  removeMember(memberId) {
    const member = this.state.members.find(m => m.id === memberId);
    if (!member) return;
    this.recordAction(`Remove member ${member.name}`);
    this.state.members = this.state.members.filter(m => m.id !== memberId);
    // Remove member from future splits
    this.state.expenses.forEach(e => {
      if (e.splitWith) {
        e.splitWith = e.splitWith.filter(id => id !== memberId);
      }
    });
    this.save();
  }

  // --- Expenses Mutations ---
  addExpense(expenseData) {
    this.recordAction(`Add expense: ${expenseData.title || 'Expense'}`);
    const newExpense = {
      id: 'exp_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      title: (expenseData.title || 'Expense').trim(),
      amount: parseFloat(expenseData.amount) || 0,
      category: expenseData.category || 'Food',
      date: expenseData.date || new Date().toISOString().slice(0, 10),
      time: expenseData.time || new Date().toTimeString().slice(0, 5),
      payerId: expenseData.payerId || 'm1', // can be member id or 'KITTY'
      isPersonal: !!expenseData.isPersonal,
      splitWith: Array.isArray(expenseData.splitWith) && expenseData.splitWith.length > 0
        ? expenseData.splitWith
        : this.state.members.map(m => m.id),
      splitMode: expenseData.splitMode || 'EQUAL', // 'EQUAL' or 'CUSTOM'
      customSplits: expenseData.customSplits || {}, // { memberId: customAmount }
      notes: (expenseData.notes || '').trim(),
      createdAt: new Date().toISOString()
    };

    // If paid by Kitty, deduct from Kitty
    if (newExpense.payerId === 'KITTY' && !newExpense.isPersonal) {
      const prevBal = this.state.kitty.balance;
      this.state.kitty.balance -= newExpense.amount;
      this.state.kitty.history.unshift({
        id: 'kh_' + Date.now(),
        type: 'EXPENSE',
        amount: newExpense.amount,
        member: 'Group Kitty',
        note: `Paid for ${newExpense.title}`,
        date: newExpense.date,
        balanceAfter: this.state.kitty.balance
      });
    }

    this.state.expenses.unshift(newExpense);
    this.save();
    return newExpense;
  }

  updateExpense(id, updatedFields) {
    const index = this.state.expenses.findIndex(e => e.id === id);
    if (index === -1) return;
    this.recordAction(`Edit expense: ${this.state.expenses[index].title}`);
    
    const existing = this.state.expenses[index];
    this.state.expenses[index] = {
      ...existing,
      ...updatedFields,
      amount: updatedFields.amount !== undefined ? parseFloat(updatedFields.amount) : existing.amount,
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  deleteExpense(id) {
    const expense = this.state.expenses.find(e => e.id === id);
    if (!expense) return;
    this.recordAction(`Delete expense: ${expense.title}`);

    // If was paid from kitty, restore kitty balance
    if (expense.payerId === 'KITTY') {
      this.state.kitty.balance += expense.amount;
      this.state.kitty.history.unshift({
        id: 'kh_' + Date.now(),
        type: 'ADJUST',
        amount: expense.amount,
        member: 'Reversal',
        note: `Restored deleted expense: ${expense.title}`,
        date: new Date().toISOString().slice(0, 10),
        balanceAfter: this.state.kitty.balance
      });
    }

    this.state.expenses = this.state.expenses.filter(e => e.id !== id);
    this.save();
  }

  // --- Kitty (Group Pool Fund) Mutations ---
  // "can add or minus or modify any amount to group amount"
  addKittyDeposit({ amount, memberId, note, date }) {
    const num = parseFloat(amount) || 0;
    if (num <= 0) return;
    const member = this.state.members.find(m => m.id === memberId);
    const memberName = member ? member.name : (memberId === 'ALL' ? 'All 6 Members' : 'Pool');

    this.recordAction(`Kitty deposit: ${this.state.currency}${num} by ${memberName}`);

    let totalAdded = num;
    // If 'ALL' is selected, everyone contributed this amount!
    if (memberId === 'ALL') {
      totalAdded = num * this.state.members.length;
    }

    this.state.kitty.balance += totalAdded;
    this.state.kitty.history.unshift({
      id: 'kh_' + Date.now(),
      type: 'DEPOSIT',
      amount: totalAdded,
      member: memberName,
      memberId: memberId,
      note: note || (memberId === 'ALL' ? `Contribution from each member (${this.state.currency}${num} x ${this.state.members.length})` : 'Kitty Deposit'),
      date: date || new Date().toISOString().slice(0, 10),
      balanceAfter: this.state.kitty.balance
    });

    this.save();
  }

  withdrawKitty({ amount, memberId, note, date }) {
    const num = parseFloat(amount) || 0;
    if (num <= 0) return;
    const member = this.state.members.find(m => m.id === memberId);
    const memberName = member ? member.name : 'Emergency / Cash';

    this.recordAction(`Kitty withdrawal: ${this.state.currency}${num}`);
    this.state.kitty.balance -= num;
    this.state.kitty.history.unshift({
      id: 'kh_' + Date.now(),
      type: 'WITHDRAW',
      amount: num,
      member: memberName,
      memberId: memberId || 'POOL',
      note: note || 'Cash withdrawn for tolls / misc',
      date: date || new Date().toISOString().slice(0, 10),
      balanceAfter: this.state.kitty.balance
    });

    this.save();
  }

  modifyKittyBalance({ newBalance, reason, date }) {
    const num = parseFloat(newBalance) || 0;
    const diff = num - this.state.kitty.balance;
    this.recordAction(`Adjust kitty to ${this.state.currency}${num}`);

    this.state.kitty.balance = num;
    this.state.kitty.history.unshift({
      id: 'kh_' + Date.now(),
      type: 'ADJUST',
      amount: Math.abs(diff),
      member: 'Manual Adjust',
      note: reason ? `${reason} (Diff: ${diff >= 0 ? '+' : ''}${diff})` : `Adjusted pool amount (Diff: ${diff >= 0 ? '+' : ''}${diff})`,
      date: date || new Date().toISOString().slice(0, 10),
      balanceAfter: num
    });

    this.save();
  }

  // --- Settlements Mutations ---
  recordSettlement({ from, to, amount, note }) {
    this.recordAction(`Settle payment of ${this.state.currency}${amount}`);
    const newSettlement = {
      id: 'set_' + Date.now(),
      from,
      to,
      amount: parseFloat(amount) || 0,
      note: note || 'Direct payment / UPI settled',
      date: new Date().toISOString().slice(0, 10),
      settled: true,
      settledAt: new Date().toISOString()
    };
    this.state.settlements.unshift(newSettlement);
    this.save();
  }

  deleteSettlement(id) {
    const s = this.state.settlements.find(item => item.id === id);
    if (!s) return;
    this.recordAction(`Delete settlement`);
    this.state.settlements = this.state.settlements.filter(item => item.id !== id);
    this.save();
  }

  // --- Notes & Numbers Directory Mutations ---
  // "can note any number , expense summary, details too"
  addNote({ type, title, content }) {
    this.recordAction(`Add note: ${title || 'Note'}`);
    const note = {
      id: 'note_' + Date.now(),
      type: type || 'note', // 'contact' | 'booking' | 'note'
      title: (title || 'Quick Note').trim(),
      content: (content || '').trim(),
      updatedAt: new Date().toISOString()
    };
    this.state.notes.unshift(note);
    this.save();
    return note;
  }

  updateNote(id, { type, title, content }) {
    const index = this.state.notes.findIndex(n => n.id === id);
    if (index === -1) return;
    this.recordAction(`Edit note: ${this.state.notes[index].title}`);
    this.state.notes[index] = {
      ...this.state.notes[index],
      type: type || this.state.notes[index].type,
      title: title !== undefined ? title.trim() : this.state.notes[index].title,
      content: content !== undefined ? content.trim() : this.state.notes[index].content,
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  deleteNote(id) {
    const note = this.state.notes.find(n => n.id === id);
    if (!note) return;
    this.recordAction(`Delete note: ${note.title}`);
    this.state.notes = this.state.notes.filter(n => n.id !== id);
    this.save();
  }

  // --- Backup Export / Import ---
  exportBackup() {
    return JSON.stringify(this.state, null, 2);
  }

  importBackup(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.members || !Array.isArray(data.members)) {
        throw new Error('Invalid backup file: Missing members list');
      }
      this.recordAction('Restore from Backup file');
      this.state = {
        ...INITIAL_STATE,
        ...data,
        settings: { ...INITIAL_STATE.settings, ...(data.settings || {}) }
      };
      this.save();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  triggerAutoSync() {
    if (!this.state.settings.googleSheetUrl || !this.state.settings.autoSync) return;
    clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      if (typeof this.onAutoSync === 'function') {
        this.onAutoSync(this.state);
      }
    }, 1800); // 1.8s debounce
  }
}

export const stateManager = new StateManager();
window.__tripHisabStateManager = stateManager;
