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
CREATE TABLE IF NOT EXISTS public.trip_members (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id      UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  color        TEXT DEFAULT '#0066FF',
  joined_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(trip_id, user_id)
);

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

-- ─── ENABLE RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Helper function: is the current user a member of a given trip?
CREATE OR REPLACE FUNCTION public.is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = trip_uuid AND user_id = auth.uid()
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
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = id AND user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Anyone can lookup trip by invite code"
  ON public.trips FOR SELECT
  USING (true);

-- ─── TRIP_MEMBERS POLICIES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members can view trip members" ON public.trip_members;
DROP POLICY IF EXISTS "Authenticated users can join trips" ON public.trip_members;
DROP POLICY IF EXISTS "Members can update their own display_name" ON public.trip_members;

CREATE POLICY "Members can view trip members"
  ON public.trip_members FOR SELECT
  USING (is_trip_member(trip_id));

CREATE POLICY "Authenticated users can join trips"
  ON public.trip_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Members can update their own display_name"
  ON public.trip_members FOR UPDATE
  USING (user_id = auth.uid());

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
END $$;

SELECT 'Schema created/updated successfully! All tables, RLS policies, and realtime configured.' AS status;
