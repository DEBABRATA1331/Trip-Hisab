// =========================================================================
// TRIP HISAB - SUPABASE CLIENT & DATABASE LAYER
// Project: xbpwwrcpswqitoxhglzd
// Includes resilient fallbacks for Chat, Route Stops, and Member Linking
// =========================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xbpwwrcpswqitoxhglzd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YgDpVwCfEmhx4OTBKerSLg_IxNm2vTk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Internal prefixes for storing Chat, Route Stops & Planned Members in `notes`
// if dedicated tables aren't migrated yet in Supabase
const CHAT_NOTE_PREFIX = '__CHAT__:';
const STOP_NOTE_PREFIX = '__ROUTE_STOP__:';
const MEMBER_NOTE_PREFIX = '__PLANNED_MEMBER__:';

// ─── AUTH HELPERS ──────────────────────────────────────────────────────────────

/** Send a 6-digit or 8-digit OTP code to the user's email (uses Magic Link / OTP template) */
export async function sendOtp(email, displayName = '') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Please enter a valid email address.');

  const opts = { shouldCreateUser: true };
  if (displayName) {
    opts.data = { display_name: displayName.trim() };
  }

  const { data, error } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: opts
  });
  if (error) throw error;
  return data;
}

/** Verify OTP code with automatic fallback for email, magiclink, or signup token types */
export async function verifyOtp(email, token, { passwordToSet = '', displayNameToSet = '' } = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanToken = String(token || '').trim().replace(/\s+/g, '');

  if (!cleanEmail) {
    throw new Error('Email address is missing. Please enter your email again.');
  }

  let verifiedData = null;
  let lastError = null;

  for (const otpType of ['email', 'magiclink', 'signup', 'recovery']) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: otpType
      });
      if (!error && data?.session) {
        verifiedData = data;
        break;
      }
      if (error) lastError = error;
    } catch (err) {
      lastError = err;
    }
  }

  if (!verifiedData) {
    throw lastError || new Error('Invalid or expired code. Please request a fresh code.');
  }

  // Once OTP is verified, save the user's chosen password & display name so future logins
  // work directly with Email + Password without needing an OTP!
  if (passwordToSet || displayNameToSet) {
    try {
      const updatePayload = {};
      if (passwordToSet && passwordToSet.length >= 6) {
        updatePayload.password = passwordToSet;
      }
      if (displayNameToSet) {
        updatePayload.data = { display_name: displayNameToSet.trim() };
      }
      if (Object.keys(updatePayload).length > 0) {
        await supabase.auth.updateUser(updatePayload);
      }
    } catch (updateErr) {
      console.warn('Could not persist password update after OTP:', updateErr);
    }
  }

  return verifiedData;
}

/**
 * Unified Auth: Sign in or Sign up with (Name, Email, Password).
 * 1. Tries direct password login first (instant if user already verified once).
 * 2. If new user, creates account via signUp.
 * 3. If Supabase requires OTP confirmation, triggers signInWithOtp (which uses the OTP template).
 */
export async function authenticateWithPassword({ name, email, password, isSignUp = false }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();

  // 1. Always attempt direct password sign-in first (fast path for returning users)
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password
  });

  if (!signInErr && signInData?.session) {
    // Update display_name if provided and not yet set
    if (cleanName && !signInData.user?.user_metadata?.display_name) {
      await supabase.auth.updateUser({ data: { display_name: cleanName } }).catch(() => {});
    }
    return { status: 'authenticated', session: signInData.session, user: signInData.user };
  }

  // 2. If user is trying to sign up (or doesn't have an account yet)
  if (isSignUp || (signInErr && signInErr.message?.toLowerCase().includes('invalid login credentials'))) {
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: { display_name: cleanName || cleanEmail.split('@')[0] }
      }
    });

    // If email confirmation is disabled in Supabase, we get a session right away!
    if (!signUpErr && signUpData?.session) {
      return { status: 'authenticated', session: signUpData.session, user: signUpData.user };
    }

    // If user already exists with a different password and wasn't signing up
    if (!isSignUp && signUpErr && signUpErr.message?.toLowerCase().includes('already registered')) {
      throw new Error('Incorrect password for this email. Try again or use "Send OTP Code" below.');
    }

    // Send OTP via signInWithOtp so it uses the "Magic link or OTP" template with {{ .Token }}
    try {
      await sendOtp(cleanEmail, cleanName);
    } catch (otpErr) {
      // Ignore rate-limit error if signUp just sent an email a millisecond ago
      console.warn('OTP trigger notice:', otpErr?.message);
    }

    return {
      status: 'needs_otp',
      email: cleanEmail,
      name: cleanName,
      password
    };
  }

  // 3. If email is not confirmed yet, trigger OTP
  if (signInErr && signInErr.message?.toLowerCase().includes('email not confirmed')) {
    try {
      await sendOtp(cleanEmail, cleanName);
    } catch (e) {}
    return {
      status: 'needs_otp',
      email: cleanEmail,
      name: cleanName,
      password
    };
  }

  throw signInErr || new Error('Could not sign in. Please check your email and password.');
}

/** Sign up a new user with email + password */
export async function signUp(email, password, displayName) {
  return authenticateWithPassword({ name: displayName, email, password, isSignUp: true });
}

/** Sign in existing user */
export async function signIn(email, password, displayName = '') {
  return authenticateWithPassword({ name: displayName, email, password, isSignUp: false });
}

/** Sign out */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Get currently logged in user */
export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Send password reset / OTP email */
export async function resetPassword(email) {
  return sendOtp(email);
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

  const memberName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Admin';
  await supabase.from('trip_members').insert({
    trip_id: data.id,
    user_id: user.id,
    display_name: memberName,
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

/**
 * Extracts either a 6-char invite code or a UUID tripId from user input
 * (Supports pasting full URLs like https://upmarkcurve.com/index.html?trip=... or 6-char codes!)
 */
export function parseInviteInput(rawInput) {
  const str = String(rawInput || '').trim();
  try {
    if (str.includes('http://') || str.includes('https://') || str.includes('?')) {
      const url = new URL(str.startsWith('http') ? str : 'https://upmarkcurve.com/' + str);
      const tripParam = url.searchParams.get('trip');
      const codeParam = url.searchParams.get('code');
      if (tripParam) return { type: 'tripId', value: tripParam.trim() };
      if (codeParam) return { type: 'code', value: codeParam.trim().toUpperCase() };
    }
  } catch (e) {}

  // Check if UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return { type: 'tripId', value: str };
  }

  return { type: 'code', value: str.toUpperCase().replace(/[^A-Z0-9]/g, '') };
}

/**
 * Join a trip by invite code OR trip ID, with smart deduplication of planned members
 */
export async function joinTripByCode(rawCodeOrLink, displayName, claimMemberId = null) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const parsed = parseInviteInput(rawCodeOrLink);
  let query = supabase.from('trips').select('id, name, invite_code, created_by');
  if (parsed.type === 'tripId') {
    query = query.eq('id', parsed.value);
  } else {
    query = query.eq('invite_code', parsed.value);
  }

  const { data: trip, error: tripErr } = await query.maybeSingle();
  if (tripErr || !trip) {
    throw new Error('Invalid invite code or link. Please double-check with your trip admin.');
  }

  // 1. Check if user is already an authenticated member of this trip
  const { data: existing } = await supabase
    .from('trip_members')
    .select('id, display_name, role')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    return { trip, alreadyMember: true, member: existing };
  }

  const cleanName = (displayName || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Traveler').trim();

  // 2. If claiming an unlinked DB row in trip_members
  if (claimMemberId && !String(claimMemberId).startsWith('note_')) {
    const { data: claimed, error: claimErr } = await supabase
      .from('trip_members')
      .update({
        user_id: user.id,
        display_name: cleanName
      })
      .eq('id', claimMemberId)
      .select()
      .maybeSingle();

    if (!claimErr && claimed) {
      return { trip, alreadyMember: false, claimed: true, member: claimed };
    }
  }

  // 3. Insert the authenticated user into trip_members (Always allowed by RLS: auth.uid() = user_id)
  const roleToAssign = trip.created_by === user.id ? 'admin' : 'member';
  const { data: newMember, error: joinErr } = await supabase
    .from('trip_members')
    .insert({
      trip_id: trip.id,
      user_id: user.id,
      display_name: cleanName,
      role: roleToAssign
    })
    .select()
    .single();

  if (joinErr) throw joinErr;

  // 4. Clean up any matching planned member note so there is never a dual entry
  try {
    const { data: allNotes } = await supabase
      .from('notes')
      .select('*')
      .eq('trip_id', trip.id);

    const plannedNotes = (allNotes || []).filter(n => n.title && n.title.startsWith(MEMBER_NOTE_PREFIX));
    for (const pn of plannedNotes) {
      const meta = JSON.parse(pn.title.slice(MEMBER_NOTE_PREFIX.length));
      if (
        (claimMemberId && pn.id === String(claimMemberId).replace('note_', '')) ||
        (meta.name && meta.name.trim().toLowerCase() === cleanName.toLowerCase())
      ) {
        await supabase.from('notes').delete().eq('id', pn.id);
      }
    }
  } catch (e) {
    console.warn('Planned member cleanup warning:', e);
  }

  return { trip, alreadyMember: false, member: newMember };
}

/**
 * Ensures the current logged-in user is registered in `trip_members` when opening a shared trip link
 */
export async function ensureUserJoinedTrip(tripId) {
  const user = await getUser();
  if (!user || !tripId) return null;

  const { data: existing } = await supabase
    .from('trip_members')
    .select('*')
    .eq('trip_id', tripId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) return existing;

  // Auto-join via tripId so opening a shared link works seamlessly
  try {
    const res = await joinTripByCode(tripId, user.user_metadata?.display_name || user.email?.split('@')[0]);
    return res.member;
  } catch (err) {
    console.warn('Auto-join on shared link failed:', err);
    return null;
  }
}

/** Get all members of a trip (combines authenticated trip_members + planned friends) */
export async function getTripMembers(tripId) {
  const { data, error } = await supabase
    .from('trip_members')
    .select('*')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true });
  if (error) throw error;

  const dbMembers = data || [];

  // Also check if admin added any planned members stored in `notes` fallback
  try {
    const { data: noteRows } = await supabase
      .from('notes')
      .select('*')
      .eq('trip_id', tripId)
      .like('title', `${MEMBER_NOTE_PREFIX}%`);

    if (noteRows && noteRows.length > 0) {
      noteRows.forEach(row => {
        try {
          const parsed = JSON.parse(row.title.slice(MEMBER_NOTE_PREFIX.length));
          const existsInDb = dbMembers.some(
            m => m.display_name.trim().toLowerCase() === (parsed.name || '').trim().toLowerCase()
          );
          if (!existsInDb && parsed.name) {
            dbMembers.push({
              id: row.id, // Valid UUID from notes table
              trip_id: tripId,
              user_id: null,
              display_name: parsed.name,
              role: 'member',
              color: parsed.color || '#0284C7',
              joined_at: row.created_at,
              _isNotePlaceholder: true
            });
          }
        } catch (e) {}
      });
    }
  } catch (e) {}

  return dbMembers;
}

/** Add an unlinked planned friend (tries trip_members first, falls back to notes if DB constraint blocks null user_id) */
export async function addPlaceholderMember(tripId, displayName) {
  const cleanName = String(displayName || '').trim();
  if (!cleanName) throw new Error('Member name is required');

  // Check if name already exists in trip
  const existingMembers = await getTripMembers(tripId);
  if (existingMembers.some(m => m.display_name.trim().toLowerCase() === cleanName.toLowerCase())) {
    throw new Error(`"${cleanName}" is already in this trip!`);
  }

  // Try inserting into trip_members with user_id: null
  const { data, error } = await supabase
    .from('trip_members')
    .insert({
      trip_id: tripId,
      user_id: null,
      display_name: cleanName,
      role: 'member'
    })
    .select()
    .maybeSingle();

  if (!error && data) return data;

  // Fallback: store in `notes` table (which is guaranteed to exist & allow insert for any trip member)
  const user = await getUser();
  const payload = JSON.stringify({ name: cleanName, color: '#0284C7' });
  const { data: noteData, error: noteErr } = await supabase
    .from('notes')
    .insert({
      trip_id: tripId,
      type: 'note',
      title: `${MEMBER_NOTE_PREFIX}${payload}`,
      content: 'Planned traveler placeholder',
      created_by: user?.id
    })
    .select()
    .single();

  if (noteErr) throw noteErr;
  return {
    id: noteData.id,
    trip_id: tripId,
    user_id: null,
    display_name: cleanName,
    role: 'member'
  };
}

/** Rename a member */
export async function renameMember(memberId, newDisplayName) {
  const clean = newDisplayName.trim();
  // Try updating trip_members first
  const { data, error } = await supabase
    .from('trip_members')
    .update({ display_name: clean })
    .eq('id', memberId)
    .select()
    .maybeSingle();

  if (!error && data) return data;

  // Fallback: check if it's a planned member stored in notes
  const { data: noteRow } = await supabase
    .from('notes')
    .select('*')
    .eq('id', memberId)
    .maybeSingle();

  if (noteRow && noteRow.title?.startsWith(MEMBER_NOTE_PREFIX)) {
    const meta = JSON.parse(noteRow.title.slice(MEMBER_NOTE_PREFIX.length));
    meta.name = clean;
    await supabase
      .from('notes')
      .update({ title: `${MEMBER_NOTE_PREFIX}${JSON.stringify(meta)}` })
      .eq('id', memberId);
  }
  return { id: memberId, display_name: clean };
}

/** Delete a member */
export async function deleteTripMember(memberId) {
  await supabase.from('trip_members').delete().eq('id', memberId);
  await supabase.from('notes').delete().eq('id', memberId);
}

// ─── EXPENSE HELPERS ──────────────────────────────────────────────────────────

export async function addExpense({ tripId, title, amount, category, date, payerMemberId, isPersonal, splitWith, notes }) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');

  const payload = {
    trip_id: tripId,
    title,
    amount,
    category: category || 'Misc',
    date: date || new Date().toISOString().slice(0, 10),
    payer_member_id: payerMemberId || null,
    is_personal: !!isPersonal,
    split_with: splitWith || [],
    notes: notes || '',
    created_by: user.id
  };

  let { data, error } = await supabase
    .from('expenses')
    .insert(payload)
    .select()
    .single();

  // If payer_member_id is a planned member from notes (FK constraint on trip_members), store payer in notes metadata
  if (error && payerMemberId) {
    payload.payer_member_id = null;
    payload.notes = `${notes || ''} [PAYER:${payerMemberId}]`.trim();
    const retry = await supabase.from('expenses').insert(payload).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return data;
}

export async function updateExpense(expenseId, updates) {
  const { data, error } = await supabase
    .from('expenses')
    .update({
      title: updates.title,
      amount: updates.amount,
      category: updates.category,
      date: updates.date,
      payer_member_id: updates.payerMemberId || null,
      is_personal: !!updates.isPersonal,
      split_with: updates.splitWith || [],
      notes: updates.notes || ''
    })
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(expenseId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
  if (error) throw error;
}

export async function getExpenses(tripId) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ─── KITTY HELPERS ────────────────────────────────────────────────────────────

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

export async function getKittyTransactions(tripId) {
  const { data, error } = await supabase
    .from('kitty_transactions')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function deleteKittyTransaction(id) {
  const { error } = await supabase.from('kitty_transactions').delete().eq('id', id);
  if (error) throw error;
}

// ─── SETTLEMENT HELPERS ───────────────────────────────────────────────────────

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

export async function getSettlements(tripId) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteSettlement(id) {
  const { error } = await supabase.from('settlements').delete().eq('id', id);
  if (error) throw error;
}

// ─── NOTES HELPERS (Filters out internal __CHAT__, __ROUTE_STOP__, __PLANNED_MEMBER__ rows) ───

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

export async function getNotes(tripId) {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).filter(n =>
    !n.title?.startsWith(CHAT_NOTE_PREFIX) &&
    !n.title?.startsWith(STOP_NOTE_PREFIX) &&
    !n.title?.startsWith(MEMBER_NOTE_PREFIX)
  );
}

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

export async function deleteNote(id) {
  const { error } = await supabase.from('notes').delete().eq('id', id);
  if (error) throw error;
}

// ─── CHAT HELPERS (Dual-engine: uses `trip_messages` OR `notes` fallback seamlessly) ────

export async function getTripMessages(tripId) {
  const combined = [];

  // 1. Try dedicated trip_messages table
  try {
    const { data, error } = await supabase
      .from('trip_messages')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true })
      .limit(150);
    if (!error && data) {
      combined.push(...data);
    }
  } catch (e) {}

  // 2. Also read any chat messages persisted in `notes` fallback
  try {
    const { data: noteChats } = await supabase
      .from('notes')
      .select('*')
      .eq('trip_id', tripId)
      .like('title', `${CHAT_NOTE_PREFIX}%`)
      .order('created_at', { ascending: true })
      .limit(150);

    if (noteChats && noteChats.length > 0) {
      noteChats.forEach(row => {
        try {
          const meta = JSON.parse(row.title.slice(CHAT_NOTE_PREFIX.length));
          combined.push({
            id: row.id,
            trip_id: tripId,
            user_id: meta.user_id || row.created_by,
            sender_name: meta.sender_name || 'Traveler',
            sender_color: meta.sender_color || '#0066FF',
            message: row.content,
            created_at: row.created_at
          });
        } catch (err) {}
      });
    }
  } catch (e) {}

  combined.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return combined;
}

export async function sendTripMessage({ tripId, message, senderName, senderColor }) {
  const user = await getUser();
  const cleanMsg = String(message || '').trim();
  if (!cleanMsg) throw new Error('Message is empty');

  const sName = senderName || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Traveler';
  const sColor = senderColor || '#0066FF';

  // 1. Try inserting into `trip_messages`
  const { data, error } = await supabase
    .from('trip_messages')
    .insert({
      trip_id: tripId,
      user_id: user?.id,
      sender_name: sName,
      sender_color: sColor,
      message: cleanMsg
    })
    .select()
    .maybeSingle();

  if (!error && data) return data;

  // 2. Automatic Fallback: store in `notes` table (works immediately without extra SQL migration!)
  const metaJson = JSON.stringify({
    sender_name: sName,
    sender_color: sColor,
    user_id: user?.id
  });

  const { data: noteRow, error: noteErr } = await supabase
    .from('notes')
    .insert({
      trip_id: tripId,
      type: 'note',
      title: `${CHAT_NOTE_PREFIX}${metaJson}`,
      content: cleanMsg,
      created_by: user?.id
    })
    .select()
    .single();

  if (noteErr) throw noteErr;

  return {
    id: noteRow.id,
    trip_id: tripId,
    user_id: user?.id,
    sender_name: sName,
    sender_color: sColor,
    message: cleanMsg,
    created_at: noteRow.created_at
  };
}

// ─── DESTINATIONS & ROUTE HELPERS (Dual-engine: `trip_destinations` OR `notes` fallback) ───

export async function getTripDestinations(tripId) {
  const stops = [];

  try {
    const { data, error } = await supabase
      .from('trip_destinations')
      .select('*')
      .eq('trip_id', tripId)
      .order('stop_order', { ascending: true });
    if (!error && data) {
      stops.push(...data);
    }
  } catch (e) {}

  try {
    const { data: noteStops } = await supabase
      .from('notes')
      .select('*')
      .eq('trip_id', tripId)
      .like('title', `${STOP_NOTE_PREFIX}%`)
      .order('created_at', { ascending: true });

    if (noteStops && noteStops.length > 0) {
      noteStops.forEach(row => {
        try {
          const meta = JSON.parse(row.title.slice(STOP_NOTE_PREFIX.length));
          stops.push({
            id: row.id,
            trip_id: tripId,
            name: meta.name,
            lat: parseFloat(meta.lat) || 0,
            lng: parseFloat(meta.lng) || 0,
            stop_order: parseInt(meta.stop_order, 10) || 1,
            stay_notes: row.content || meta.stay_notes || '',
            est_duration: meta.est_duration || '',
            created_at: row.created_at
          });
        } catch (err) {}
      });
    }
  } catch (e) {}

  stops.sort((a, b) => (a.stop_order - b.stop_order) || (new Date(a.created_at) - new Date(b.created_at)));
  return stops;
}

export async function addTripDestination({ tripId, name, lat, lng, stopOrder, stayNotes, estDuration }) {
  const user = await getUser();
  const cleanName = String(name || '').trim();

  const { data, error } = await supabase
    .from('trip_destinations')
    .insert({
      trip_id: tripId,
      name: cleanName,
      lat: parseFloat(lat) || 0,
      lng: parseFloat(lng) || 0,
      stop_order: parseInt(stopOrder, 10) || 1,
      stay_notes: stayNotes || '',
      est_duration: estDuration || '',
      created_by: user?.id
    })
    .select()
    .maybeSingle();

  if (!error && data) return data;

  // Fallback to `notes` table so route stops always persist even before SQL migration
  const metaJson = JSON.stringify({
    name: cleanName,
    lat: parseFloat(lat) || 0,
    lng: parseFloat(lng) || 0,
    stop_order: parseInt(stopOrder, 10) || 1,
    est_duration: estDuration || ''
  });

  const { data: noteRow, error: noteErr } = await supabase
    .from('notes')
    .insert({
      trip_id: tripId,
      type: 'note',
      title: `${STOP_NOTE_PREFIX}${metaJson}`,
      content: stayNotes || '',
      created_by: user?.id
    })
    .select()
    .single();

  if (noteErr) throw noteErr;

  return {
    id: noteRow.id,
    trip_id: tripId,
    name: cleanName,
    lat: parseFloat(lat) || 0,
    lng: parseFloat(lng) || 0,
    stop_order: parseInt(stopOrder, 10) || 1,
    stay_notes: stayNotes || '',
    est_duration: estDuration || '',
    created_at: noteRow.created_at
  };
}

export async function deleteTripDestination(id) {
  await supabase.from('trip_destinations').delete().eq('id', id);
  await supabase.from('notes').delete().eq('id', id);
}

// ─── REALTIME ────────────────────────────────────────────────────────────────

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

  return () => supabase.removeChannel(channel);
}
