// =========================================================================
// TRIP HISAB - SUPABASE CLIENT & DATABASE LAYER
// Project: xbpwwrcpswqitoxhglzd
// =========================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xbpwwrcpswqitoxhglzd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YgDpVwCfEmhx4OTBKerSLg_IxNm2vTk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── AUTH HELPERS ──────────────────────────────────────────────────────────────

/** Sign up a new user with email + password */
export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  return data;
}

/** Sign in existing user */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Sign out */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Get currently logged in user */
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Send password reset email */
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=1'
  });
  if (error) throw error;
}

/** Listen to auth state changes */
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
}

// ─── TRIP HELPERS ──────────────────────────────────────────────────────────────

/** Create a new trip */
export async function createTrip({ name, currency = '₹', budget = 0 }) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  // Generate a random invite code
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { data, error } = await supabase
    .from('trips')
    .insert({
      name,
      currency,
      budget,
      invite_code: inviteCode,
      created_by: user.id
    })
    .select()
    .single();

  if (error) throw error;

  // Auto-join as admin member
  await supabase.from('trip_members').insert({
    trip_id: data.id,
    user_id: user.id,
    display_name: user.user_metadata?.display_name || user.email,
    role: 'admin'
  });

  return data;
}

/** Get all trips the current user is a member of */
export async function getMyTrips() {
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('trip_members')
    .select(`
      role,
      display_name,
      trips (
        id, name, currency, budget, invite_code, created_by, created_at
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(row => ({ ...row.trips, myRole: row.role, myDisplayName: row.display_name }));
}

/** Get a single trip by ID */
export async function getTrip(tripId) {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();
  if (error) throw error;
  return data;
}

/** Update trip settings */
export async function updateTrip(tripId, updates) {
  const { data, error } = await supabase
    .from('trips')
    .update(updates)
    .eq('id', tripId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Join a trip by invite code */
export async function joinTripByCode(inviteCode, displayName) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  // Find the trip
  const { data: trip, error: tripErr } = await supabase
    .from('trips')
    .select('id, name')
    .eq('invite_code', inviteCode.toUpperCase().trim())
    .single();

  if (tripErr || !trip) throw new Error('Invalid invite code. Please check and try again.');

  // Check if already a member
  const { data: existing } = await supabase
    .from('trip_members')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .single();

  if (existing) return { trip, alreadyMember: true };

  // Join!
  const { error: joinErr } = await supabase.from('trip_members').insert({
    trip_id: trip.id,
    user_id: user.id,
    display_name: displayName || user.user_metadata?.display_name || user.email,
    role: 'member'
  });

  if (joinErr) throw joinErr;
  return { trip, alreadyMember: false };
}

/** Get all members of a trip */
export async function getTripMembers(tripId) {
  const { data, error } = await supabase
    .from('trip_members')
    .select('*')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─── EXPENSE HELPERS ──────────────────────────────────────────────────────────

/** Add a new expense */
export async function addExpense({ tripId, title, amount, category, date, payerMemberId, isPersonal, splitWith, notes }) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      trip_id: tripId,
      title,
      amount,
      category: category || 'Misc',
      date: date || new Date().toISOString().slice(0, 10),
      payer_member_id: payerMemberId,
      is_personal: !!isPersonal,
      split_with: splitWith || [],
      notes: notes || '',
      created_by: user.id
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Get all expenses for a trip */
export async function getExpenses(tripId) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('trip_id', tripId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Update an expense */
export async function updateExpense(expenseId, updates) {
  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete an expense */
export async function deleteExpense(expenseId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
  if (error) throw error;
}

// ─── KITTY HELPERS ──────────────────────────────────────────────────────────

/** Add a kitty transaction (deposit/withdraw/adjust) */
export async function addKittyTransaction({ tripId, type, amount, memberName, note, date }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('kitty_transactions')
    .insert({
      trip_id: tripId,
      type,
      amount,
      member_name: memberName || 'Pool',
      note: note || '',
      date: date || new Date().toISOString().slice(0, 10),
      created_by: user?.id
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Get all kitty transactions for a trip */
export async function getKittyTransactions(tripId) {
  const { data, error } = await supabase
    .from('kitty_transactions')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Delete a kitty transaction */
export async function deleteKittyTransaction(id) {
  const { error } = await supabase.from('kitty_transactions').delete().eq('id', id);
  if (error) throw error;
}

// ─── SETTLEMENT HELPERS ────────────────────────────────────────────────────

/** Record a settlement payment */
export async function addSettlement({ tripId, fromMemberId, toMemberId, amount, note }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('settlements')
    .insert({
      trip_id: tripId,
      from_member_id: fromMemberId,
      to_member_id: toMemberId,
      amount,
      note: note || 'Direct payment',
      created_by: user?.id
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Get all settlements for a trip */
export async function getSettlements(tripId) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Delete a settlement */
export async function deleteSettlement(id) {
  const { error } = await supabase.from('settlements').delete().eq('id', id);
  if (error) throw error;
}

// ─── NOTES HELPERS ────────────────────────────────────────────────────────

/** Add a note */
export async function addNote({ tripId, type, title, content }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('notes')
    .insert({
      trip_id: tripId,
      type: type || 'note',
      title,
      content,
      created_by: user?.id
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Get all notes for a trip */
export async function getNotes(tripId) {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Update a note */
export async function updateNote(noteId, updates) {
  const { data, error } = await supabase
    .from('notes')
    .update(updates)
    .eq('id', noteId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a note */
export async function deleteNote(id) {
  const { error } = await supabase.from('notes').delete().eq('id', id);
  if (error) throw error;
}

// ─── REALTIME ────────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time changes for a trip.
 * Fires callback with { table, eventType, record } on any insert/update/delete.
 */
export function subscribeToTrip(tripId, callback) {
  const channel = supabase
    .channel(`trip-${tripId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'expenses', ...payload }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kitty_transactions', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'kitty_transactions', ...payload }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'settlements', ...payload }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'notes', ...payload }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'trip_members', ...payload }))
    .subscribe();

  // Return unsubscribe function
  return () => supabase.removeChannel(channel);
}

