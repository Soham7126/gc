DROP POLICY IF EXISTS "Allow public inserts" ON bookings;
DROP POLICY IF EXISTS "Allow public select" ON bookings;
DROP TABLE IF EXISTS bookings;

CREATE TABLE bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL,
  booking_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  station_type TEXT NOT NULL,
  station_name TEXT NOT NULL,
  num_players INTEGER NOT NULL DEFAULT 1,
  duration_hours INTEGER NOT NULL DEFAULT 1,
  total_price NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  -- Stored as bookingAttemptKey:stationType so one customer can book PC + PS together.
  idempotency_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency ON bookings (idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public inserts" ON bookings
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public select" ON bookings
  FOR SELECT TO anon
  USING (true);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
