import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Server-only — credentials never exposed to the browser
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSlotHour(timeSlot: string) {
  return Number(timeSlot.slice(0, 2));
}

function bookingCoversSlot(bookingTime: string, durationHours: number, slotTime: string) {
  const bookingStart = getSlotHour(bookingTime);
  const bookingEnd = bookingStart + (durationHours || 1);
  const slotStart = getSlotHour(slotTime);
  return bookingStart < slotStart + 1 && slotStart < bookingEnd;
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('bookings')
      .select('time_slot, station_type, num_players, duration_hours')
      .eq('booking_date', date)
      .eq('status', 'confirmed');

    if (error) {
      console.error('Availability fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 });
    }

    // Only return the minimal data needed — never expose IDs or names
    const times = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
    const expandedBookings = times.flatMap((slotTime) =>
      (data || [])
        .filter((b: { time_slot: string; duration_hours: number }) => bookingCoversSlot(b.time_slot, b.duration_hours, slotTime))
        .map((b: { station_type: string; num_players: number }) => ({
          time_slot: slotTime,
          station_type: b.station_type,
          num_players: b.num_players,
        })),
    );

    return NextResponse.json({ bookings: expandedBookings });
  } catch (err) {
    console.error('Availability API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
