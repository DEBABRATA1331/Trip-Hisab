-- =========================================================================
-- TRIP HISAB - SUPABASE DATABASE SCHEMA (IDEMPOTENT / RE-RUNNABLE)
-- Run this entire script in: Supabase Dashboard → SQL Editor → New Query
-- =========================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── TRIPS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trips (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT 'My Trip',
  currency    TEXT NOT NULL DEFAULT '₹',
  budget      NUMERIC DEFAULT 0,
  invite_code TEXT UNIQUE NOT NULL DEFAULT upper(substr(md5(random()::text), 1, 6)),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── TRIP MEMBERS ────────────────────────────────────────────────────────────
-- user_id is NULLABLE so admin can add planned friend names ("Rohan", "Priya")
-- before they have signed up or joined. When a friend joins, their user_id is linked!
CREATE TABLE IF NOT EXISTS public.trip_members (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id      UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  color        TEXT DEFAULT '#0066FF',
  joined_at    TIMESTAMPTZ DEFAULT now()
);

-- If user_id column previously had NOT NULL, remove constraint
DO $$
BEGIN
  ALTER TABLE public.trip_members ALTER COLUMN user_id DROP NOT NULL;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Drop legacy unique constraint that prevented multiple unlinked placeholder members
ALTER TABLE public.trip_members DROP CONSTRAINT IF EXISTS trip_members_trip_id_user_id_key;

-- Ensure an authenticated user can only be linked to a trip once (ignoring NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_members_unique_user 
  ON public.trip_members(trip_id, user_id) 
  WHERE user_id IS NOT NULL;

-- ─── EXPENSES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id          UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  title            TEXT NOT NULL,
  amount           NUMERIC NOT NULL DEFAULT 0,
  category         TEXT DEFAULT 'Misc',
  date             DATE DEFAULT CURRENT_DATE,
  payer_member_id  UUID REFERENCES public.trip_members(id) ON DELETE SET NULL,
  is_personal      BOOLEAN DEFAULT FALSE,
  split_with       UUID[] DEFAULT '{}',
  notes            TEXT DEFAULT '',
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ─── KITTY TRANSACTIONS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitty_transactions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id     UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAW', 'ADJUST', 'EXPENSE')),
  amount      NUMERIC NOT NULL DEFAULT 0,
  member_name TEXT DEFAULT 'Pool',
  note        TEXT DEFAULT '',
  date        DATE DEFAULT CURRENT_DATE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ─── SETTLEMENTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.settlements (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id        UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  from_member_id UUID REFERENCES public.trip_members(id) ON DELETE SET NULL,
  to_member_id   UUID REFERENCES public.trip_members(id) ON DELETE SET NULL,
  amount         NUMERIC NOT NULL DEFAULT 0,
  note           TEXT DEFAULT 'Direct payment',
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ─── NOTES ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id    UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  type       TEXT DEFAULT 'note' CHECK (type IN ('contact', 'booking', 'note')),
  title      TEXT NOT NULL,
  content    TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── TRIP CHAT MESSAGES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_messages (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id      UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name  TEXT NOT NULL,
  sender_color TEXT DEFAULT '#0066FF',
  message      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── TRIP DESTINATIONS & ROUTE STOPS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_destinations (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id      UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  name         TEXT NOT NULL,
  lat          NUMERIC NOT NULL DEFAULT 0,
  lng          NUMERIC NOT NULL DEFAULT 0,
  stop_order   INTEGER NOT NULL DEFAULT 1,
  stay_notes   TEXT DEFAULT '',
  est_duration TEXT DEFAULT '',
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── ENABLE RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_destinations ENABLE ROW LEVEL SECURITY;

-- Helper function: is the current user a member of a given trip?
CREATE OR REPLACE FUNCTION public.is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = trip_uuid AND created_by = auth.uid()
  );
$$;

-- ─── TRIPS POLICIES ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members can view their trips" ON public.trips;
DROP POLICY IF EXISTS "Authenticated users can create trips" ON public.trips;
DROP POLICY IF EXISTS "Trip admins can update trip" ON public.trips;
DROP POLICY IF EXISTS "Anyone can lookup trip by invite code" ON public.trips;

CREATE POLICY "Members can view their trips"
  ON public.trips FOR SELECT
  USING (is_trip_member(id));

CREATE POLICY "Authenticated users can create trips"
  ON public.trips FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Trip admins can update trip"
  ON public.trips FOR UPDATE
  USING (is_trip_member(id));

CREATE POLICY "Anyone can lookup trip by invite code"
  ON public.trips FOR SELECT
  USING (true);

-- ─── TRIP_MEMBERS POLICIES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members can view trip members" ON public.trip_members;
DROP POLICY IF EXISTS "Authenticated users can join trips" ON public.trip_members;
DROP POLICY IF EXISTS "Members or admins can update members" ON public.trip_members;
DROP POLICY IF EXISTS "Trip members can add placeholder members" ON public.trip_members;
DROP POLICY IF EXISTS "Trip members can delete members" ON public.trip_members;

CREATE POLICY "Members can view trip members"
  ON public.trip_members FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can join trips"
  ON public.trip_members FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Members or admins can update members"
  ON public.trip_members FOR UPDATE
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can delete members"
  ON public.trip_members FOR DELETE
  USING (is_trip_member(trip_id));

-- ─── EXPENSES POLICIES ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Trip members can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Trip members can add expenses" ON public.expenses;
DROP POLICY IF EXISTS "Trip members can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Trip members can delete expenses" ON public.expenses;

CREATE POLICY "Trip members can view expenses"
  ON public.expenses FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can add expenses"
  ON public.expenses FOR INSERT
  WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "Trip members can update expenses"
  ON public.expenses FOR UPDATE
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can delete expenses"
  ON public.expenses FOR DELETE
  USING (is_trip_member(trip_id));

-- ─── KITTY POLICIES ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Trip members can view kitty" ON public.kitty_transactions;
DROP POLICY IF EXISTS "Trip members can add kitty transactions" ON public.kitty_transactions;
DROP POLICY IF EXISTS "Trip members can delete kitty transactions" ON public.kitty_transactions;

CREATE POLICY "Trip members can view kitty"
  ON public.kitty_transactions FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can add kitty transactions"
  ON public.kitty_transactions FOR INSERT
  WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "Trip members can delete kitty transactions"
  ON public.kitty_transactions FOR DELETE
  USING (is_trip_member(trip_id));

-- ─── SETTLEMENTS POLICIES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Trip members can view settlements" ON public.settlements;
DROP POLICY IF EXISTS "Trip members can add settlements" ON public.settlements;
DROP POLICY IF EXISTS "Trip members can delete settlements" ON public.settlements;

CREATE POLICY "Trip members can view settlements"
  ON public.settlements FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can add settlements"
  ON public.settlements FOR INSERT
  WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "Trip members can delete settlements"
  ON public.settlements FOR DELETE
  USING (is_trip_member(trip_id));

-- ─── NOTES POLICIES ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Trip members can view notes" ON public.notes;
DROP POLICY IF EXISTS "Trip members can add notes" ON public.notes;
DROP POLICY IF EXISTS "Trip members can update notes" ON public.notes;
DROP POLICY IF EXISTS "Trip members can delete notes" ON public.notes;

CREATE POLICY "Trip members can view notes"
  ON public.notes FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can add notes"
  ON public.notes FOR INSERT
  WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "Trip members can update notes"
  ON public.notes FOR UPDATE
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can delete notes"
  ON public.notes FOR DELETE
  USING (is_trip_member(trip_id));

-- ─── TRIP_MESSAGES POLICIES ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Trip members can view messages" ON public.trip_messages;
DROP POLICY IF EXISTS "Trip members can send messages" ON public.trip_messages;

CREATE POLICY "Trip members can view messages"
  ON public.trip_messages FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can send messages"
  ON public.trip_messages FOR INSERT
  WITH CHECK (is_trip_member(trip_id));

-- ─── TRIP_DESTINATIONS POLICIES ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Trip members can view destinations" ON public.trip_destinations;
DROP POLICY IF EXISTS "Trip members can insert destinations" ON public.trip_destinations;
DROP POLICY IF EXISTS "Trip members can update destinations" ON public.trip_destinations;
DROP POLICY IF EXISTS "Trip members can delete destinations" ON public.trip_destinations;

CREATE POLICY "Trip members can view destinations"
  ON public.trip_destinations FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can insert destinations"
  ON public.trip_destinations FOR INSERT
  WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "Trip members can update destinations"
  ON public.trip_destinations FOR UPDATE
  USING (is_trip_member(trip_id));

CREATE POLICY "Trip members can delete destinations"
  ON public.trip_destinations FOR DELETE
  USING (is_trip_member(trip_id));

-- ─── REALTIME ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'expenses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'kitty_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kitty_transactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'settlements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.settlements;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'trip_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'trip_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'trip_destinations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_destinations;
  END IF;
END $$;

SELECT 'Schema updated successfully! Trip chat, destinations, placeholder members, and realtime active.' AS status;
