// =========================================================================
// TRIP HISAB - SUPABASE CLIENT & DATABASE LAYER
// Project: xbpwwrcpswqitoxhglzd
// =========================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xbpwwrcpswqitoxhglzd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YgDpVwCfEmhx4OTBKerSLg_IxNm2vTk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── AUTH HELPERS ──────────────────────────────────────────────────────────────

/** Send a 6-digit or 8-digit OTP code to the user's email */
export async function sendOtp(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: {
      shouldCreateUser: true
    }
  });
  if (error) throw error;
  return data;
}

/** Verify OTP code with automatic fallback for email, magiclink, or signup token types */
export async function verifyOtp(email, token) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanToken = String(token || '').trim().replace(/\s+/g, '');

  if (!cleanEmail) {
    throw new Error('Email address is missing. Please enter your email again.');
  }

  // 1. Try 'email' type (standard email OTP)
  let lastError = null;
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'email'
    });
    if (!error && data?.session) return data;
    if (error) lastError = error;
  } catch (err) {
    lastError = err;
  }

  // 2. Try 'magiclink' type
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'magiclink'
    });
    if (!error && data?.session) return data;
    if (error) lastError = error;
  } catch (err) {
    lastError = err;
  }

  // 3. Try 'signup' type (if new user confirmation)
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'signup'
    });
    if (!error && data?.session) return data;
    if (error) lastError = error;
  } catch (err) {
    lastError = err;
  }

  throw lastError || new Error('Invalid or expired code. Please request a new code.');
}

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
  if (!user) throw new Error('You must be logged in to create a trip.');

  // Generate a random 6-character alphanumeric uppercase invite code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let inviteCode = '';
  for (let i = 0; i < 6; i++) {
    inviteCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const { data, error } = await supabase
    .from('trips')
    .insert({
      name: (name || 'My Trip').trim(),
      currency: currency || '₹',
      budget: parseFloat(budget) || 0,
      invite_code: inviteCode,
      created_by: user.id
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating trip:', error);
    throw error;
  }

  // Auto-join as admin member
  const memberName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Admin';
  const { error: memberErr } = await supabase.from('trip_members').insert({
    trip_id: data.id,
    user_id: user.id,
    display_name: memberName,
    role: 'admin'
  });

  if (memberErr) {
    console.warn('Creator already added or member insert warning:', memberErr);
  }

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
      joined_at,
      trips (
        id, name, currency, budget, invite_code, created_by, created_at
      )
    `)
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false });

  if (error) {
    console.error('Error fetching trips:', error);
    throw error;
  }
  return (data || [])
    .filter(row => row.trips)
    .map(row => ({
      ...row.trips,
      myRole: row.role,
      myDisplayName: row.display_name
    }));
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

/** Join a trip by invite code, with optional claiming of an existing placeholder member */
export async function joinTripByCode(inviteCode, displayName, claimMemberId = null) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  // Find the trip
  const { data: trip, error: tripErr } = await supabase
    .from('trips')
    .select('id, name')
    .eq('invite_code', inviteCode.toUpperCase().trim())
    .single();

  if (tripErr || !trip) throw new Error('Invalid invite code. Please check and try again.');

  // Check if user is already a member
  const { data: existing } = await supabase
    .from('trip_members')
    .select('id, display_name, role')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) return { trip, alreadyMember: true, member: existing };

  // If user explicitly chose to claim an existing unlinked placeholder (e.g. "Rohan")
  if (claimMemberId) {
    const finalName = displayName || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Traveler';
    const { data: claimed, error: claimErr } = await supabase
      .from('trip_members')
      .update({
        user_id: user.id,
        display_name: finalName
      })
      .eq('id', claimMemberId)
      .select()
      .single();

    if (claimErr) throw claimErr;
    return { trip, alreadyMember: false, claimed: true, member: claimed };
  }

  const cleanName = (displayName || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Traveler').trim();

  // Check if there is an unlinked placeholder with this exact name to auto-link
  const { data: placeholders } = await supabase
    .from('trip_members')
    .select('id, display_name')
    .eq('trip_id', trip.id)
    .is('user_id', null);

  const matched = (placeholders || []).find(p => p.display_name.trim().toLowerCase() === cleanName.toLowerCase());
  if (matched) {
    const { data: autoLinked, error: linkErr } = await supabase
      .from('trip_members')
      .update({
        user_id: user.id,
        display_name: cleanName
      })
      .eq('id', matched.id)
      .select()
      .single();
    if (!linkErr && autoLinked) {
      return { trip, alreadyMember: false, claimed: true, member: autoLinked };
    }
  }

  // If there are unlinked placeholder members, return them so UI can ask the user if they are one of them
  if (placeholders && placeholders.length > 0 && !displayName) {
    return { trip, needsClaimChoice: true, placeholders };
  }

  // Otherwise, join as a new member
  const { data: newMember, error: joinErr } = await supabase
    .from('trip_members')
    .insert({
      trip_id: trip.id,
      user_id: user.id,
      display_name: cleanName,
      role: 'member'
    })
    .select()
    .single();

  if (joinErr) throw joinErr;
  return { trip, alreadyMember: false, member: newMember };
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

/** Add an unlinked placeholder member (e.g. Admin adds "Rohan" before Rohan joins) */
export async function addPlaceholderMember(tripId, displayName) {
  const cleanName = String(displayName || '').trim();
  if (!cleanName) throw new Error('Member name is required');
  const { data, error } = await supabase
    .from('trip_members')
    .insert({
      trip_id: tripId,
      user_id: null,
      display_name: cleanName,
      role: 'member'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Rename a member */
export async function renameMember(memberId, newDisplayName) {
  const { data, error } = await supabase
    .from('trip_members')
    .update({ display_name: newDisplayName.trim() })
    .eq('id', memberId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a member */
export async function deleteTripMember(memberId) {
  const { error } = await supabase
    .from('trip_members')
    .delete()
    .eq('id', memberId);
  if (error) throw error;
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

// ─── CHAT HELPERS ────────────────────────────────────────────────────────────

/** Get trip messages */
export async function getTripMessages(tripId) {
  const { data, error } = await supabase
    .from('trip_messages')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) {
    console.warn('Could not load messages (table might not exist yet):', error);
    return [];
  }
  return data || [];
}

/** Send a trip message */
export async function sendTripMessage({ tripId, message, senderName, senderColor }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('trip_messages')
    .insert({
      trip_id: tripId,
      user_id: user?.id,
      sender_name: senderName || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Traveler',
      sender_color: senderColor || '#0066FF',
      message: message.trim()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── DESTINATIONS & ROUTE HELPERS ─────────────────────────────────────────────

/** Get trip destinations / route stops */
export async function getTripDestinations(tripId) {
  const { data, error } = await supabase
    .from('trip_destinations')
    .select('*')
    .eq('trip_id', tripId)
    .order('stop_order', { ascending: true });
  if (error) {
    console.warn('Could not load destinations:', error);
    return [];
  }
  return data || [];
}

/** Add a destination stop */
export async function addTripDestination({ tripId, name, lat, lng, stopOrder, stayNotes, estDuration }) {
  const user = await getUser();
  const { data, error } = await supabase
    .from('trip_destinations')
    .insert({
      trip_id: tripId,
      name: name.trim(),
      lat: parseFloat(lat) || 0,
      lng: parseFloat(lng) || 0,
      stop_order: parseInt(stopOrder, 10) || 1,
      stay_notes: stayNotes || '',
      est_duration: estDuration || '',
      created_by: user?.id
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a destination stop */
export async function deleteTripDestination(id) {
  const { error } = await supabase
    .from('trip_destinations')
    .delete()
    .eq('id', id);
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'trip_messages', ...payload }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_destinations', filter: `trip_id=eq.${tripId}` }, payload => callback({ table: 'trip_destinations', ...payload }))
    .subscribe();

  // Return unsubscribe function
  return () => supabase.removeChannel(channel);
}

