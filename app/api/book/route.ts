import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Server-only Supabase client — these vars are NEVER sent to the browser
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const VALID_STATIONS = ['pc', 'ps', 'rc'];
const STATION_LABELS: Record<string, string> = { pc: 'PC', ps: 'PS', rc: 'RC' };
const MAX_STATIONS: Record<string, number> = { pc: 4, ps: 4, rc: 1 };
const VALID_TIMES = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const VALID_DURATIONS = [1, 2, 3];

function getSlotHour(timeSlot: string) {
  return Number(timeSlot.slice(0, 2));
}

function bookingsOverlap(startHour: number, durationHours: number, existingStart: number, existingDuration: number) {
  const endHour = startHour + durationHours;
  const existingEnd = existingStart + existingDuration;
  return existingStart < endHour && startHour < existingEnd;
}

function getStationIdempotencyKey(idempotencyKey: string | undefined, stationId: string) {
  return idempotencyKey ? `${idempotencyKey}:${stationId}` : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, date, time, stations, durationHours = 1, idempotencyKey } = body;

    // ---------- INPUT VALIDATION ----------

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
      return NextResponse.json({ error: 'Please enter a valid name' }, { status: 400 });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    // Date must be today or within the next 7 days
    const bookingDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 7);
    if (bookingDate < today || bookingDate > maxDate) {
      return NextResponse.json({ error: 'Date must be within the next 7 days' }, { status: 400 });
    }

    if (!time || !VALID_TIMES.includes(time)) {
      return NextResponse.json({ error: 'Invalid time slot' }, { status: 400 });
    }

    if (!Number.isInteger(durationHours) || !VALID_DURATIONS.includes(durationHours)) {
      return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });
    }

    if (getSlotHour(time) + durationHours > 24) {
      return NextResponse.json({ error: 'This duration goes past closing time. Please pick an earlier slot.' }, { status: 400 });
    }

    if (!stations || typeof stations !== 'object') {
      return NextResponse.json({ error: 'Invalid station selection' }, { status: 400 });
    }

    // Validate each station type and count
    const stationEntries: [string, number][] = Object.entries(stations)
      .filter(([, count]) => (count as number) > 0)
      .map(([id, count]) => [id, count as number]);

    if (stationEntries.length === 0) {
      return NextResponse.json({ error: 'No stations selected' }, { status: 400 });
    }

    for (const [stationId, count] of stationEntries) {
      if (!VALID_STATIONS.includes(stationId)) {
        return NextResponse.json({ error: `Unknown station type: ${stationId}` }, { status: 400 });
      }
      if (!Number.isInteger(count) || count < 1 || count > MAX_STATIONS[stationId]) {
        return NextResponse.json({ error: `Invalid count for ${STATION_LABELS[stationId]}` }, { status: 400 });
      }
    }

    // ---------- AVAILABILITY CHECK ----------

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: existing, error: fetchErr } = await supabase
      .from('bookings')
      .select('station_type, num_players, time_slot, duration_hours')
      .eq('booking_date', date)
      .eq('status', 'confirmed');

    if (fetchErr) {
      console.error('Availability check failed:', fetchErr);
      return NextResponse.json({ error: 'Could not verify availability' }, { status: 500 });
    }

    // Calculate used capacity per station
    const used: Record<string, number> = {};
    const requestedStartHour = getSlotHour(time);
    (existing || []).forEach((b: { station_type: string; num_players: number; time_slot: string; duration_hours: number }) => {
      if (bookingsOverlap(requestedStartHour, durationHours, getSlotHour(b.time_slot), b.duration_hours || 1)) {
        used[b.station_type] = (used[b.station_type] || 0) + b.num_players;
      }
    });

    for (const [stationId, count] of stationEntries) {
      const available = MAX_STATIONS[stationId] - (used[stationId] || 0);
      if (count > available) {
        return NextResponse.json(
          { error: `Only ${available} ${STATION_LABELS[stationId]} station(s) left for this slot` },
          { status: 409 }
        );
      }
    }

    // ---------- IDEMPOTENCY CHECK ----------
    // Prevent duplicate bookings from double-clicks
    if (idempotencyKey) {
      const { data: dup } = await supabase
        .from('bookings')
        .select('id')
        .like('idempotency_key', `${idempotencyKey}:%`)
        .limit(1);

      if (dup && dup.length > 0) {
        // Already processed — return the existing booking ID
        return NextResponse.json({ bookingId: dup[0].id, duplicate: true });
      }
    }

    // ---------- INSERT BOOKINGS ----------

    const bookings = stationEntries.map(([stationId, count]) => ({
      customer_name: name.trim(),
      booking_date: date,
      time_slot: time,
      station_type: stationId,
      station_name: STATION_LABELS[stationId],
      num_players: count,
      duration_hours: durationHours,
      total_price: 0,
      status: 'confirmed',
      ...(idempotencyKey ? { idempotency_key: getStationIdempotencyKey(idempotencyKey, stationId) } : {}),
    }));

    const { data, error: insertErr } = await supabase
      .from('bookings')
      .insert(bookings)
      .select();

    if (insertErr) {
      console.error('Insert failed:', insertErr);
      if (insertErr.code === '23505') {
        return NextResponse.json({ error: 'This slot was just booked. Please refresh.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
    }

    return NextResponse.json({ bookingId: data?.[0]?.id || '' });
  } catch (err) {
    console.error('Booking API error:', err);
    return NextResponse.json({ error: 'Server error. Please try again.' }, { status: 500 });
  }
}
