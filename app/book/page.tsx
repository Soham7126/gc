'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

const STATIONS = [
  { id: 'pc', label: 'PC', max: 4 },
  { id: 'rc', label: 'RC', max: 1 },
  { id: 'ps', label: 'PS', max: 4 },
];

const TIMES = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const DURATIONS = [1, 2, 3];

function getNext7Days() {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function fmt(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAvailableTimesForDate(dateStr: string, now: Date) {
  if (!dateStr) return TIMES;
  if (dateStr !== fmt(now)) return TIMES;

  return TIMES.filter((time) => Number(time.slice(0, 2)) > now.getHours());
}

// Generate a unique key for each booking attempt to prevent duplicates
function generateIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type Availability = Record<string, Record<string, number>>;

export default function BookPage() {
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({ pc: 0, rc: 0, ps: 0 });
  const [date, setDate] = useState('');
  const [avail, setAvail] = useState<Availability>({});
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [selectedTime, setSelectedTime] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookingId, setBookingId] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [durationHours, setDurationHours] = useState(1);

  // Ref-based guard against double-clicks (synchronous, unlike useState)
  const isSubmitting = useRef(false);
  const idempotencyKeyRef = useRef('');

  // Auto-updating dates: recalculates when the day rolls over
  const [dates, setDates] = useState(getNext7Days);

  useEffect(() => {
    // Check every 30s if the day changed; if so, refresh dates
    const timer = setInterval(() => {
      const currentNow = new Date();
      setNow(currentNow);
      const freshDates = getNext7Days();
      const currentFirst = fmt(dates[0]);
      const newFirst = fmt(freshDates[0]);
      if (currentFirst !== newFirst) {
        setDates(freshDates);
        // If the user's selected date fell off the window, clear it
        const validDateStrings = freshDates.map(fmt);
        if (date && !validDateStrings.includes(date)) {
          setDate('');
          if (step >= 2) setStep(1); // go back to date picker
        }
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [dates, date, step]);

  const availableTimes = getAvailableTimesForDate(date, now);

  const selectedSummary = STATIONS
    .filter(s => counts[s.id] > 0)
    .map(s => `${counts[s.id]} ${s.label}`)
    .join(', ');

  const hasSelection = Object.values(counts).some(c => c > 0);

  const updateCount = (id: string, delta: number) => {
    const station = STATIONS.find(s => s.id === id);
    if (!station) return;
    setCounts(prev => ({
      ...prev,
      [id]: Math.max(0, Math.min(station.max, (prev[id] || 0) + delta)),
    }));
  };

  // Fetch availability via server API (no direct DB access)
  const fetchAvailability = useCallback(async (dateStr: string) => {
    setLoadingAvail(true);
    const base: Availability = {};
    TIMES.forEach(t => {
      base[t] = {};
      STATIONS.forEach(s => { base[t][s.id] = s.max; });
    });

    try {
      const res = await fetch(`/api/availability?date=${dateStr}`);
      if (res.ok) {
        const json = await res.json();
        (json.bookings || []).forEach((b: { time_slot: string; station_type: string; num_players: number }) => {
          if (base[b.time_slot] && base[b.time_slot][b.station_type] !== undefined) {
            base[b.time_slot][b.station_type] = Math.max(0, base[b.time_slot][b.station_type] - b.num_players);
          }
        });
      }
    } catch {
      // If API is down, show all as available
    }

    setAvail(base);
    setLoadingAvail(false);
  }, []);

  useEffect(() => {
    if (!date) return;

    const timer = window.setTimeout(() => {
      void fetchAvailability(date);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [date, fetchAvailability]);

  const slotFitsSelection = (slot: Record<string, number>) => {
    return STATIONS.every(s => (slot[s.id] ?? s.max) >= counts[s.id]);
  };

  const durationFitsSelection = (startTime: string, hours: number) => {
    const startHour = Number(startTime.slice(0, 2));
    if (startHour + hours > 24) return false;

    return Array.from({ length: hours }, (_, offset) => `${String(startHour + offset).padStart(2, '0')}:00`)
      .every((slotTime) => slotFitsSelection(avail[slotTime] || {}));
  };

  const selectTime = (t: string) => {
    if (!availableTimes.includes(t) || !slotFitsSelection(avail[t] || {})) return;
    setSelectedTime(t);
    setStep(3);
  };

  // Generate a fresh idempotency key when entering the confirmation step
  useEffect(() => {
    if (step === 5) {
      idempotencyKeyRef.current = generateIdempotencyKey();
      isSubmitting.current = false; // Reset on entering confirm step
    }
  }, [step]);

  const handleBook = async () => {
    // Guard: prevent double-click (synchronous check)
    if (isSubmitting.current) return;
    if (!hasSelection || !name.trim()) return;

    isSubmitting.current = true;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          date,
          time: selectedTime,
          stations: counts,
          durationHours,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Booking failed');
      }

      setBookingId(json.bookingId || '');
      setStep(6);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      isSubmitting.current = false; // Allow retry on genuine error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="booking-page">
      <Link href="/" className="back-link">Back to Home</Link>
      <h1 className="page-title">BOOK YOUR SLOT</h1>

      {/* Step 0: Pick stations */}
      {step === 0 && (
        <div className="card" key="s0">
          <div className="card-question">What do you want to play?</div>

          <div className="station-cards">
            {STATIONS.map(s => (
              <div
                key={s.id}
                className={`station-card ${counts[s.id] > 0 ? 'selected' : ''}`}
                {...(s.max === 1 ? {
                  onClick: () => setCounts(prev => ({ ...prev, [s.id]: prev[s.id] > 0 ? 0 : 1 })),
                  style: { cursor: 'pointer' },
                } : {})}
              >
                <div className="station-name">{s.label}</div>
                <div className="station-slots">{s.max} {s.max === 1 ? 'station' : 'stations'}</div>
                {s.max > 1 ? (
                  <div className="station-counter">
                    <button className="cnt-btn" onClick={() => updateCount(s.id, -1)}>−</button>
                    <span className="cnt-val">{counts[s.id]}</span>
                    <button className="cnt-btn" onClick={() => updateCount(s.id, 1)}>+</button>
                  </div>
                ) : (
                  <div className={`sim-toggle ${counts[s.id] > 0 ? 'active' : ''}`}>
                    {counts[s.id] > 0 ? '✓ Selected' : 'Tap to select'}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="nav-row">
            <button className="next-btn" disabled={!hasSelection} onClick={() => setStep(1)}>
              NEXT
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Pick date */}
      {step === 1 && (
        <div className="card" key="s1">
          <div className="card-question">Pick a day</div>
          <div className="selection-tag">{selectedSummary}</div>
          <div className="date-row">
            {dates.map(d => {
              const ds = fmt(d);
              return (
                <button
                  key={ds}
                  className={`date-btn ${date === ds ? 'selected' : ''}`}
                  onClick={() => { setDate(ds); setStep(2); }}
                >
                  <div className="d-day">{d.toLocaleDateString('en', { weekday: 'short' })}</div>
                  <div className="d-num">{d.getDate()}</div>
                  <div className="d-month">{d.toLocaleDateString('en', { month: 'short' })}</div>
                </button>
              );
            })}
          </div>
          <div className="nav-row">
            <button className="back-btn" onClick={() => setStep(0)}>BACK</button>
          </div>
        </div>
      )}

      {/* Step 2: Availability Grid */}
      {step === 2 && (
        <div className="wide-card" key="s2">
          <div className="grid-header">
            <button className="back-btn" onClick={() => setStep(1)}>BACK</button>
            <div>
              <div className="card-question" style={{ marginBottom: '0.2rem' }}>
                {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                Booking: {selectedSummary} &mdash; Tap a 24-hour slot to book
              </div>
            </div>
            <div style={{ width: '70px' }}></div>
          </div>

          {loadingAvail ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>Loading...</div>
          ) : (
            <div className="avail-grid">
              {availableTimes.length === 0 && (
                <div className="empty-slots">No more slots are available for today. Please pick another day.</div>
              )}

              {availableTimes.map(t => {
                const slot = avail[t] || {};
                const totalFree = STATIONS.reduce((s, st) => s + (slot[st.id] ?? st.max), 0);
                const fits = slotFitsSelection(slot);

                return (
                  <button
                    key={t}
                    className={`slot-card ${!fits ? 'full' : ''}`}
                    onClick={() => selectTime(t)}
                    disabled={!fits}
                  >
                    <div className="slot-time">{t}</div>

                    <div className="slot-rows">
                      {STATIONS.map(st => {
                        const free = slot[st.id] ?? st.max;
                        const enough = free >= counts[st.id];
                        return (
                          <div key={st.id} className="slot-row">
                            <span className="slot-label">{st.label}</span>
                            <span className={`slot-badge ${!enough ? 'badge-full' : free === 0 ? 'badge-full' : 'badge-free'}`}>
                              {free === 0 ? 'Full' : `${free} free`}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className={`slot-footer ${!fits ? 'footer-full' : ''}`}>
                      {!fits
                        ? '✕ Not enough stations'
                        : `✓ ${totalFree} stations free total`
                      }
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Name */}
      {step === 3 && (
        <div className="card" key="s3">
          <div className="card-question">How long do you want to play?</div>
          <div className="selection-tag">{selectedSummary} &mdash; {selectedTime}, {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          <div className="duration-choice-row">
            {DURATIONS.map((hours) => (
              <button
                className={`duration-choice ${durationHours === hours ? 'selected' : ''}`}
                disabled={!durationFitsSelection(selectedTime, hours)}
                key={hours}
                onClick={() => setDurationHours(hours)}
                type="button"
              >
                {hours} {hours === 1 ? 'hour' : 'hours'}
              </button>
            ))}
          </div>
          <div className="nav-row">
            <button className="back-btn" onClick={() => setStep(2)}>BACK</button>
            <button className="next-btn" onClick={() => setStep(4)}>
              NEXT
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Name */}
      {step === 4 && (
        <div className="card" key="s3">
          <div className="card-question">What is your name?</div>
          <div className="selection-tag">{selectedSummary} &mdash; {durationHours}h &mdash; {selectedTime}, {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          <input
            className="name-input"
            type="text"
            placeholder="Type your name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <div className="nav-row">
            <button className="back-btn" onClick={() => setStep(3)}>BACK</button>
            <button className="next-btn" disabled={!name.trim()} onClick={() => setStep(5)}>
              NEXT
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Confirm */}
      {step === 5 && (
        <div className="card" key="s4">
          <div className="card-question">Does this look right?</div>
          <div className="done-info">
            <div className="done-row">
              <span className="lbl">Name</span>
              <span className="val">{name}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Playing</span>
              <span className="val">{selectedSummary}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Day</span>
              <span className="val">{new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Time</span>
              <span className="val">{selectedTime}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Duration</span>
              <span className="val">{durationHours} {durationHours === 1 ? 'hour' : 'hours'}</span>
            </div>
          </div>

          {error && (
            <p style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'center', marginBottom: '1rem' }}>
              {error}
            </p>
          )}

          <div className="nav-row">
            <button className="back-btn" onClick={() => setStep(4)}>BACK</button>
            <button className="next-btn" onClick={handleBook} disabled={loading}>
              {loading ? 'BOOKING...' : 'BOOK IT'}
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Done */}
      {step === 6 && (
        <div className="card" key="s5">
          <div className="done-circle">✓</div>
          <div className="done-title">You are booked!</div>
          <div className="done-sub">See you at the cafe, {name}!</div>
          <div className="done-info">
            <div className="done-row">
              <span className="lbl">Playing</span>
              <span className="val">{selectedSummary}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Day</span>
              <span className="val">{new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Time</span>
              <span className="val">{selectedTime}</span>
            </div>
            <div className="done-row">
              <span className="lbl">Duration</span>
              <span className="val">{durationHours} {durationHours === 1 ? 'hour' : 'hours'}</span>
            </div>
            {bookingId && (
              <div className="done-row">
                <span className="lbl">Booking ID</span>
                <span className="val" style={{ fontSize: '0.75rem' }}>{bookingId.slice(0, 8)}</span>
              </div>
            )}
          </div>
          <Link href="/" className="home-link">BACK TO HOME</Link>
        </div>
      )}
    </div>
  );
}
