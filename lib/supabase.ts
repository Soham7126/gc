import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key || url === 'your_supabase_url_here') {
      throw new Error('Supabase credentials not configured. Update .env.local');
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Database types
export interface Booking {
  id?: string;
  customer_name: string;
  booking_date: string;
  time_slot: string;
  station_type: string;
  station_name: string;
  num_players: number;
  duration_hours: number;
  total_price: number;
  status: 'confirmed' | 'pending' | 'cancelled';
  created_at?: string;
}
