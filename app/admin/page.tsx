'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

type Duration = '1h' | '2h' | '3h' | 'infinity';
type RealtimeState = 'connecting' | 'connected' | 'offline';

type Station = {
  id: string;
  name: string;
  number: string;
  kind: string;
  type: 'pc' | 'ps' | 'rc';
  icon: 'monitor' | 'gamepad' | 'car';
};

type StationState = {
  customer: string;
  date: string;
  time: string;
  duration: Duration;
  startedAt: number | null;
  endsAt: number | null;
  elapsedSeconds: number;
};

type BookingRecord = {
  id: string;
  customer_name: string;
  booking_date: string;
  time_slot: string;
  station_type: 'pc' | 'ps' | 'rc';
  station_name: string;
  num_players: number;
  duration_hours: number;
  status: 'confirmed' | 'pending' | 'cancelled';
  created_at?: string;
};

type ActiveBooking = BookingRecord & {
  stationId: string;
  startedAt: number;
  endsAt: number;
};

const groups: Array<{ title: string; icon: Station['icon']; items: Station[] }> = [
  {
    title: 'PCs',
    icon: 'monitor',
    items: Array.from({ length: 4 }, (_, index) => ({
      id: `pc-${index + 1}`,
      name: `PC ${index + 1}`,
      number: String(index + 1),
      kind: 'PC',
      type: 'pc',
      icon: 'monitor',
    })),
  },
  {
    title: 'PlayStations',
    icon: 'gamepad',
    items: Array.from({ length: 4 }, (_, index) => ({
      id: `ps-${index + 1}`,
      name: `PS ${index + 1}`,
      number: String(index + 1),
      kind: 'PlayStation',
      type: 'ps',
      icon: 'gamepad',
    })),
  },
  {
    title: 'RC',
    icon: 'car',
    items: [
      {
        id: 'rc-1',
        name: 'RC 1',
        number: '1',
        kind: 'Racing Controller',
        type: 'rc',
        icon: 'car',
      },
    ],
  },
];

const stationTypeOrder: Array<BookingRecord['station_type']> = ['pc', 'ps', 'rc'];
const durations: Duration[] = ['1h', '2h', '3h', 'infinity'];
const times = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const STATION_SESSIONS_KEY = 'upside-down-admin-station-sessions';

type PersistedStationSession = Pick<StationState, 'customer' | 'date' | 'time' | 'duration' | 'startedAt' | 'endsAt'>;

function loadStationSessions(): Record<string, PersistedStationSession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STATION_SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PersistedStationSession>) : {};
  } catch {
    return {};
  }
}

function hoursToDuration(hours: number): Duration {
  if (hours >= 3) return '3h';
  if (hours >= 2) return '2h';
  return '1h';
}

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultTime(now = new Date()) {
  return `${String((now.getHours() + 1) % 24).padStart(2, '0')}:00`;
}

function getDateOptions() {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);

    const value = formatDateValue(date);
    const label = date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    return { value, label };
  });
}

function getInitialStationState(date: string): StationState {
  return {
    customer: '',
    date,
    time: getDefaultTime(),
    duration: '1h',
    startedAt: null,
    endsAt: null,
    elapsedSeconds: 0,
  };
}

function getDurationMs(duration: Duration) {
  if (duration === 'infinity') return null;
  return Number(duration.replace('h', '')) * 60 * 60 * 1000;
}

function getBookingStartMs(booking: BookingRecord) {
  return new Date(`${booking.booking_date}T${booking.time_slot}:00`).getTime();
}

function getBookingEndMs(booking: BookingRecord) {
  return getBookingStartMs(booking) + booking.duration_hours * 60 * 60 * 1000;
}

function formatClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatFriendlyDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function getDurationLabel(hours: number) {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function mapBookingRow(row: unknown): BookingRecord {
  const booking = row as BookingRecord;
  return {
    ...booking,
    duration_hours: Number(booking.duration_hours) || 1,
    status: booking.status || 'confirmed',
  };
}

function getActiveBookingsByStation(bookings: BookingRecord[], now: number) {
  const activeByStation: Record<string, ActiveBooking> = {};
  const stationIdsByType = Object.fromEntries(
    stationTypeOrder.map((type) => [
      type,
      groups.flatMap((group) => group.items).filter((station) => station.type === type).map((station) => station.id),
    ]),
  ) as Record<BookingRecord['station_type'], string[]>;

  const usedByType: Record<BookingRecord['station_type'], number> = { pc: 0, ps: 0, rc: 0 };
  const activeBookings = bookings
    .filter((booking) => booking.status === 'confirmed')
    .map((booking) => ({
      booking,
      startedAt: getBookingStartMs(booking),
      endsAt: getBookingEndMs(booking),
    }))
    .filter(({ startedAt, endsAt }) => now >= startedAt && now < endsAt)
    .sort((a, b) => a.startedAt - b.startedAt || (a.booking.created_at || '').localeCompare(b.booking.created_at || ''));

  activeBookings.forEach(({ booking, startedAt, endsAt }) => {
    const stationIds = stationIdsByType[booking.station_type] || [];
    for (let index = 0; index < booking.num_players; index += 1) {
      const stationId = stationIds[usedByType[booking.station_type]];
      usedByType[booking.station_type] += 1;
      if (stationId) {
        activeByStation[stationId] = { ...booking, stationId, startedAt, endsAt };
      }
    }
  });

  return activeByStation;
}

function StationIcon({ type }: { type: Station['icon'] }) {
  if (type === 'gamepad') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 15h2m-1-1v2m7-1h.01M17 16h.01M6.8 9h10.4c1.1 0 2 .8 2.2 1.9l.8 4.6c.2 1.3-.8 2.5-2.1 2.5-.7 0-1.3-.3-1.7-.8L15 15.5H9l-1.4 1.7c-.4.5-1 .8-1.7.8-1.3 0-2.3-1.2-2.1-2.5l.8-4.6C4.8 9.8 5.7 9 6.8 9Z" />
      </svg>
    );
  }

  if (type === 'car') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 17h.01M17 17h.01M5 17H3v-3l2.2-.7 1.4-3.1C7 9.5 7.7 9 8.5 9h7c.8 0 1.5.5 1.9 1.2l1.4 3.1 2.2.7v3h-2M9 17h6M6.2 13h11.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 19h8M12 15v4M5 5h14v10H5z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3v4M16 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function DurationLabel({ value }: { value: Duration }) {
  if (value === 'infinity') {
    return (
      <svg className="duration-infinity" viewBox="0 0 24 24" aria-label="Unlimited">
        <path d="M7.5 8.5c2.5 0 6.5 7 9 7a3.5 3.5 0 1 0 0-7c-2.5 0-6.5 7-9 7a3.5 3.5 0 1 1 0-7Z" />
      </svg>
    );
  }

  return value;
}

export default function AdminPage() {
  const allStations = useMemo(() => groups.flatMap((group) => group.items), []);
  const stationIds = useMemo(() => allStations.map((item) => item.id), [allStations]);
  const [now, setNow] = useState(() => Date.now());
  const [dateOptions, setDateOptions] = useState(getDateOptions);
  const [stations, setStations] = useState<Record<string, StationState>>(() =>
    Object.fromEntries(stationIds.map((id) => [id, getInitialStationState(dateOptions[0].value)])),
  );
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('connecting');
  const [hasHydratedSessions, setHasHydratedSessions] = useState(false);
  const [newBooking, setNewBooking] = useState({
    customer_name: '',
    station_type: 'pc' as 'pc' | 'ps' | 'rc',
    num_players: 1,
    payment_mode: 'online' as 'online' | 'cash',
    booking_date: formatDateValue(new Date()),
    time_slot: getDefaultTime(),
    duration_hours: 1,
  });
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);

  const activeBookingsByStation = useMemo(() => getActiveBookingsByStation(bookings, now), [bookings, now]);
  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status === 'confirmed' && getBookingEndMs(booking) >= now)
        .sort((a, b) => getBookingStartMs(a) - getBookingStartMs(b)),
    [bookings, now],
  );

  useEffect(() => {
    const persistedStationSessions = loadStationSessions();

    if (Object.keys(persistedStationSessions).length > 0) {
      setStations(
        Object.fromEntries(
          stationIds.map((id) => {
            const saved = persistedStationSessions[id];
            const initial = getInitialStationState(dateOptions[0].value);
            if (!saved?.startedAt) return [id, initial];
            return [id, { ...initial, ...saved, elapsedSeconds: 0 }];
          }),
        ),
      );
    }

    setHasHydratedSessions(true);
  }, [dateOptions, stationIds]);

  useEffect(() => {
    if (!hasHydratedSessions) return;
    const sessionsToPersist = Object.fromEntries(
      Object.entries(stations)
        .filter(([, station]) => station.startedAt !== null)
        .map(([id, station]) => [
          id,
          {
            customer: station.customer,
            date: station.date,
            time: station.time,
            duration: station.duration,
            startedAt: station.startedAt,
            endsAt: station.endsAt,
          },
        ]),
    );
    localStorage.setItem(STATION_SESSIONS_KEY, JSON.stringify(sessionsToPersist));
  }, [hasHydratedSessions, stations]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);

      const freshDateOptions = getDateOptions();
      setDateOptions((currentOptions) => (
        currentOptions[0]?.value === freshDateOptions[0].value ? currentOptions : freshDateOptions
      ));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Function to fetch bookings
  const fetchBookings = async () => {
    try {
      const supabase = getSupabase();
      const today = formatDateValue(new Date());

      const { data, error } = await supabase
        .from('bookings')
        .select('id, customer_name, booking_date, time_slot, station_type, station_name, num_players, duration_hours, status, created_at')
        .gte('booking_date', today)
        .order('booking_date', { ascending: true })
        .order('time_slot', { ascending: true });

      if (error) {
        console.error('Admin bookings fetch failed:', error);
        return;
      }

      setBookings((data || []).map(mapBookingRow));
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
    }
  };

  useEffect(() => {
    let isMounted = true;

    try {
      const supabase = getSupabase();

      // Initial fetch
      fetchBookings();

      // Set up realtime subscription
      const channel = supabase
        .channel('admin-bookings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, (payload) => {
          setBookings((current) => {
            if (payload.eventType === 'DELETE') {
              const oldBooking = mapBookingRow(payload.old);
              return current.filter((booking) => booking.id !== oldBooking.id);
            }

            const nextBooking = mapBookingRow(payload.new);
            if (nextBooking.status !== 'confirmed') {
              return current.filter((booking) => booking.id !== nextBooking.id);
            }

            const withoutCurrent = current.filter((booking) => booking.id !== nextBooking.id);
            return [...withoutCurrent, nextBooking].sort((a, b) => getBookingStartMs(a) - getBookingStartMs(b));
          });
          if (isMounted) setRealtimeState('connected');
        })
        .subscribe((status) => {
          if (!isMounted) return;
          setRealtimeState(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' ? 'offline' : 'connecting');
        });

      // Polling fallback - fetch every 5 seconds to ensure data is always fresh
      const pollInterval = window.setInterval(() => {
        if (isMounted) fetchBookings();
      }, 5000);

      return () => {
        isMounted = false;
        void supabase.removeChannel(channel);
        window.clearInterval(pollInterval);
      };
    } catch (error) {
      console.error('Admin realtime setup failed:', error);
      window.queueMicrotask(() => setRealtimeState('offline'));
    }
  }, []);

  function updateStation(id: string, update: Partial<StationState>) {
    setStations((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...update,
      },
    }));
  }

  function startStation(id: string, durationHours?: number) {
    setStations((current) => {
      const station = current[id];
      const duration = durationHours ? hoursToDuration(durationHours) : station.duration;
      const durationMs = durationHours ? durationHours * 60 * 60 * 1000 : getDurationMs(station.duration);
      const startedAt = Date.now();

      return {
        ...current,
        [id]: {
          ...station,
          duration,
          startedAt,
          endsAt: durationMs ? startedAt + durationMs : null,
          elapsedSeconds: 0,
        },
      };
    });
  }

  function stopStation(id: string) {
    setStations((current) => ({
      ...current,
      [id]: {
        ...current[id],
        startedAt: null,
        endsAt: null,
        elapsedSeconds: 0,
      },
    }));
  }

  async function submitNewBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!newBooking.customer_name.trim()) return;

    setIsSubmittingBooking(true);
    try {
      const response = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBooking.customer_name,
          date: newBooking.booking_date,
          time: newBooking.time_slot,
          durationHours: newBooking.duration_hours,
          paymentMode: newBooking.payment_mode,
          stations: {
            [newBooking.station_type]: newBooking.num_players,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Error: ${error.error || 'Failed to create booking'}`);
        return;
      }

      // Reset form
      setNewBooking({
        customer_name: '',
        station_type: 'pc',
        num_players: 1,
        payment_mode: 'online',
        booking_date: formatDateValue(new Date()),
        time_slot: getDefaultTime(),
        duration_hours: 1,
      });
      alert('Booking created successfully!');
    } catch (error) {
      console.error('Booking submission failed:', error);
      alert('Failed to create booking');
    } finally {
      setIsSubmittingBooking(false);
    }
  }

  return (
    <main className="admin-page">
      <section className="admin-bookings-section" aria-labelledby="bookings-heading">
        <div className="admin-bookings-heading">
          <div>
            <h1 id="bookings-heading" className="admin-section-title">
              <CalendarIcon />
              Bookings
            </h1>
            <p>{upcomingBookings.length} upcoming or active booking{upcomingBookings.length === 1 ? '' : 's'}</p>
          </div>
          <span className={`admin-realtime-status ${realtimeState}`}>
            {realtimeState === 'connected' ? 'Live' : realtimeState === 'offline' ? 'Offline' : 'Connecting'}
          </span>
        </div>

        <div className="admin-add-booking-form">
          <h2 className="admin-form-title">Add New Booking</h2>
          <form onSubmit={submitNewBooking} className="admin-booking-form">
            <div className="admin-form-row">
              <label className="admin-form-group">
                <span>Customer Name</span>
                <input
                  type="text"
                  value={newBooking.customer_name}
                  onChange={(e) => setNewBooking({ ...newBooking, customer_name: e.target.value })}
                  placeholder="Enter customer name"
                  disabled={isSubmittingBooking}
                  required
                />
              </label>

              <label className="admin-form-group">
                <span>Station Type</span>
                <select
                  value={newBooking.station_type}
                  onChange={(e) => setNewBooking({ ...newBooking, station_type: e.target.value as 'pc' | 'ps' | 'rc' })}
                  disabled={isSubmittingBooking}
                >
                  <option value="pc">PC</option>
                  <option value="ps">PlayStation</option>
                  <option value="rc">Racing Controller</option>
                </select>
              </label>
            </div>

            <div className="admin-form-row">
              <label className="admin-form-group">
                <span>Number of Players</span>
                <select
                  value={newBooking.num_players.toString()}
                  onChange={(e) => setNewBooking({ ...newBooking, num_players: parseInt(e.target.value, 10) || 1 })}
                  disabled={isSubmittingBooking}
                >
                  <option value="1">1 Player</option>
                  <option value="2">2 Players</option>
                  <option value="3">3 Players</option>
                  <option value="4">4 Players</option>
                  <option value="4">5 Players</option>
                  <option value="4">6 Players</option>
                  <option value="4">7 Players</option>
                  <option value="4">8 Players</option>
                </select>
              </label>

              <label className="admin-form-group">
                <span>Payment Mode</span>
                <select
                  value={newBooking.payment_mode}
                  onChange={(e) => setNewBooking({ ...newBooking, payment_mode: e.target.value as 'online' | 'cash' })}
                  disabled={isSubmittingBooking}
                >
                  <option value="online">Online</option>
                  <option value="cash">Cash</option>
                </select>
              </label>

              <label className="admin-form-group">
                <span>Date</span>
                <input
                  type="date"
                  value={newBooking.booking_date}
                  onChange={(e) => setNewBooking({ ...newBooking, booking_date: e.target.value })}
                  disabled={isSubmittingBooking}
                  required
                />
              </label>
            </div>

            <div className="admin-form-row">
              <label className="admin-form-group">
                <span>Time Slot</span>
                <select
                  value={newBooking.time_slot}
                  onChange={(e) => setNewBooking({ ...newBooking, time_slot: e.target.value })}
                  disabled={isSubmittingBooking}
                >
                  {times.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-form-group">
                <span>Duration (hours)</span>
                <select
                  value={newBooking.duration_hours.toString()}
                  onChange={(e) => setNewBooking({ ...newBooking, duration_hours: parseInt(e.target.value, 10) || 1 })}
                  disabled={isSubmittingBooking}
                >
                  <option value="1">1 hour</option>
                  <option value="2">2 hours</option>
                  <option value="3">3 hours</option>
                </select>
              </label>
            </div>

            <button type="submit" className="admin-submit-booking-btn" disabled={isSubmittingBooking || !newBooking.customer_name.trim()}>
              {isSubmittingBooking ? 'Creating...' : 'Create Booking'}
            </button>
          </form>
        </div>

        {upcomingBookings.length === 0 ? (
          <div className="admin-empty-bookings">No confirmed bookings yet.</div>
        ) : (
          <div className="admin-bookings-list">
            {upcomingBookings.map((booking) => {
              return (
                <article className="admin-booking-row" key={booking.id}>
                  <div className="booking-details">
                    <div>
                      <strong>{booking.customer_name}</strong>
                      <span>{booking.station_name} x {booking.num_players}</span>
                    </div>
                    <div>
                      <strong>{formatFriendlyDate(booking.booking_date)}</strong>
                      <span>{booking.time_slot}</span>
                    </div>
                    <div>
                      <strong>{getDurationLabel(booking.duration_hours)}</strong>
                      <span>Scheduled</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {groups.map((group) => (
        <section className="admin-section" key={group.title} aria-labelledby={`${group.title}-heading`}>
          <h1 id={`${group.title}-heading`} className="admin-section-title">
            <StationIcon type={group.icon} />
            {group.title}
          </h1>

          <div className="admin-grid">
            {group.items.map((item) => {
              const bookedStation = activeBookingsByStation[item.id];
              const station = stations[item.id];
              const isRunning = Boolean(station.startedAt);
              const stationView = station;
              const remainingSeconds = stationView.endsAt ? Math.ceil((stationView.endsAt - now) / 1000) : 0;
              const elapsedSeconds = stationView.startedAt ? Math.floor((now - stationView.startedAt) / 1000) : station.elapsedSeconds;
              const displayTime = isRunning
                ? stationView.duration === 'infinity'
                  ? formatClock(elapsedSeconds)
                  : formatClock(remainingSeconds)
                : null;
              const isDone = stationView.endsAt ? remainingSeconds <= 0 : false;
              const stationStatus = bookedStation 
                ? `${bookedStation.customer_name} (${getDurationLabel(bookedStation.duration_hours)} @ ${bookedStation.time_slot})`
                : stationView.customer || 'Free';

              return (
                <article className={isRunning ? 'admin-station-card running' : 'admin-station-card'} key={item.id}>
                  <div className="admin-card-top">
                    <div className="admin-station-meta">
                      <div className="admin-icon-box">
                        <StationIcon type={item.icon} />
                      </div>
                      <div>
                        <h2>
                          {item.name.replace(` ${item.number}`, '')} <span>{item.number}</span>
                        </h2>
                        <p>{item.kind}</p>
                      </div>
                    </div>
                    <span className={isRunning ? 'admin-status busy' : bookedStation ? 'admin-status booked' : 'admin-status'}>{isRunning ? 'Busy' : bookedStation ? 'Booked' : 'Free'}</span>
                  </div>

                  {bookedStation && (
                    <div className="admin-booking-info">
                      <div><strong>Customer:</strong> {bookedStation.customer_name}</div>
                      <div><strong>Duration:</strong> {getDurationLabel(bookedStation.duration_hours)}</div>
                      <div><strong>Time:</strong> {bookedStation.time_slot}</div>
                      <div><strong>Station:</strong> {bookedStation.station_name}</div>
                      <div><strong>Players:</strong> {bookedStation.num_players}</div>
                    </div>
                  )}

                  {!bookedStation && (
                    <>
                      <input
                        className="admin-customer-input"
                        aria-label={`${item.name} customer name`}
                        disabled={isRunning}
                        onChange={(event) => updateStation(item.id, { customer: event.target.value })}
                        placeholder="Customer name"
                        value={stationView.customer}
                      />

                      <label className="admin-select-field">
                        <CalendarIcon />
                        <select
                          aria-label={`${item.name} date`}
                          disabled={isRunning}
                          onChange={(event) => updateStation(item.id, { date: event.target.value })}
                          value={stationView.date}
                        >
                          {dateOptions.map((date) => (
                            <option key={date.value} value={date.value}>
                              {date.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="admin-select-field">
                        <ClockIcon />
                        <select
                          aria-label={`${item.name} time`}
                          disabled={isRunning}
                          onChange={(event) => updateStation(item.id, { time: event.target.value })}
                          value={stationView.time}
                        >
                          {times.map((time) => (
                            <option key={time} value={time}>
                              {time}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="admin-duration-row" aria-label={`${item.name} duration`}>
                        {durations.map((duration) => (
                          <button
                            className={duration === stationView.duration ? 'selected' : ''}
                            disabled={isRunning}
                            onClick={() => updateStation(item.id, { duration })}
                            type="button"
                            key={duration}
                            aria-pressed={duration === stationView.duration}
                          >
                            <DurationLabel value={duration} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {displayTime && <div className={isDone ? 'admin-timer done' : 'admin-timer'}>{isDone ? '00:00:00' : displayTime}</div>}

                  <button
                    className={isRunning ? 'admin-start-button stop' : 'admin-start-button'}
                    onClick={() => (isRunning ? stopStation(item.id) : startStation(item.id, bookedStation?.duration_hours))}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={isRunning ? 'M7 7h10v10H7Z' : 'm8 5 11 7-11 7Z'} />
                    </svg>
                    <span>{isRunning ? 'Stop Timer' : 'Start Timer'}</span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}

    </main>
  );
}
