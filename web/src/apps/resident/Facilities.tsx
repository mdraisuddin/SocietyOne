import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarDays, CheckCircle2, Clock, MapPin, Users } from 'lucide-react';
import { get, post } from '../../lib/api';
import { addDaysISO, dateLong, dayLabel, time12, timeRange, todayISO } from '../../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Segmented, Sheet, useToast } from '../../components/ui';
import { MobileHeader } from './ResidentApp';

export function FacilitiesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['facilities'], queryFn: () => get('/facilities'), staleTime: 5 * 60_000 });
  return (
    <>
      <MobileHeader
        title="Facilities"
        back="/app"
        action={
          <Link to="/app/facilities/bookings" className="btn btn-sm btn-soft">
            My bookings
          </Link>
        }
      />
      <main className="mobile-main stack">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          data.facilities.map((f: any) => (
            <Link key={f.id} to={`/app/facilities/${f.id}`} className="card card-link row">
              {f.imageUrl ? (
                <img src={f.imageUrl} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} />
              ) : (
                <span className="icon-tile qa-green" style={{ width: 56, height: 56, borderRadius: 16 }}>
                  <CalendarDays size={24} />
                </span>
              )}
              <div className="grow">
                <div className="strong">{f.name}</div>
                <div className="small muted">
                  {timeRange(f.openTime, f.closeTime)} • {f.slotDurationMinutes >= 60 ? `${f.slotDurationMinutes / 60} h` : `${f.slotDurationMinutes} min`} slots
                </div>
                {f.location && <div className="xsmall muted">{f.location}</div>}
              </div>
            </Link>
          ))
        )}
      </main>
    </>
  );
}

export function FacilityPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<any>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState<any>(null);
  const { data: fd, isLoading } = useQuery({ queryKey: ['facility', id], queryFn: () => get(`/facilities/${id}`), staleTime: 5 * 60_000 });
  const avail = useQuery({ queryKey: ['availability', id, date], queryFn: () => get(`/facilities/${id}/availability?date=${date}`), refetchInterval: 30_000 });
  const book = useMutation({
    mutationFn: () => post(`/facilities/${id}/bookings`, { date, startTime: slot.startTime, durationMinutes: duration ?? undefined }),
    onSuccess: (r) => {
      setConfirmed(r.booking);
      setSlot(null);
      qc.invalidateQueries({ queryKey: ['availability', id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: any) => {
      toast(e.message, 'error');
      qc.invalidateQueries({ queryKey: ['availability', id, date] });
    },
  });
  if (isLoading) return <Loading />;
  const f = fd.facility;
  const days = Array.from({ length: Math.min(f.advanceBookingDays, 13) + 1 }, (_, i) => addDaysISO(today, i));
  const durations = Array.from({ length: Math.floor(f.maxBookingMinutes / f.slotDurationMinutes) }, (_, i) => (i + 1) * f.slotDurationMinutes);
  return (
    <>
      <MobileHeader title={f.name} back="/app/facilities" />
      <main className="mobile-main stack">
        {f.imageUrl && <img src={f.imageUrl} alt="" style={{ width: '100%', height: 170, objectFit: 'cover', borderRadius: 18 }} />}
        <Card>
          {f.description && <p className="secondary">{f.description}</p>}
          <div className="row-wrap mt-2 small secondary">
            <span className="row" style={{ gap: 6 }}><Clock size={16} /> {timeRange(f.openTime, f.closeTime)}</span>
            {f.location && <span className="row" style={{ gap: 6 }}><MapPin size={16} /> {f.location}</span>}
            <span className="row" style={{ gap: 6 }}><Users size={16} /> Up to {f.capacity}</span>
          </div>
        </Card>

        <div className="section-title" style={{ margin: '8px 0 0' }}>
          <h2>Choose a date</h2>
        </div>
        <div className="date-strip" role="group" aria-label="Date">
          {days.map((d) => {
            const dt = new Date(`${d}T00:00:00Z`);
            return (
              <button key={d} type="button" className="date-pill" aria-pressed={d === date} onClick={() => (setDate(d), setSlot(null))} aria-label={dateLong(d)}>
                <span className="w">{d === today ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</span>
                <span className="d">{dt.getUTCDate()}</span>
              </button>
            );
          })}
        </div>

        <div className="section-title" style={{ margin: '8px 0 0' }}>
          <h2>Available time slots</h2>
          <span className="xsmall muted">{dayLabel(date)}</span>
        </div>
        {avail.isLoading ? (
          <Loading />
        ) : !avail.data?.bookable ? (
          <Empty title="Not bookable">{avail.data?.reason}</Empty>
        ) : !avail.data.slots.length ? (
          <Empty title="No slots on this day" />
        ) : (
          <div className="slot-grid">
            {avail.data.slots.map((s: any) => (
              <button
                key={s.slotId}
                type="button"
                className={`slot ${s.status === 'mine' ? 'mine' : ''}`}
                disabled={s.status !== 'available'}
                aria-pressed={slot?.slotId === s.slotId}
                onClick={() => (setSlot(s), setDuration(null))}
                aria-label={`${timeRange(s.startTime, s.endTime)} ${s.status}`}
              >
                {time12(s.startTime)}
                <small>{s.status === 'available' ? (f.maxConcurrentBookings > 1 ? `${s.remaining} left` : 'Available') : s.status === 'mine' ? 'Your booking' : s.status === 'past' ? 'Past' : 'Booked'}</small>
              </button>
            ))}
          </div>
        )}
        {f.rules && (
          <Card title="Rules">
            <p className="small secondary pre">{f.rules}</p>
          </Card>
        )}
        <div style={{ height: 70 }} />
      </main>

      {slot && (
        <div className="fab" style={{ left: 'max(18px, calc(50% - 262px))', right: 'max(18px, calc(50% - 262px))', background: 'var(--surface)', padding: 12, border: '1px solid var(--border)' }}>
          {durations.length > 1 && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {durations.map((d) => (
                <button key={d} type="button" className="chip" aria-pressed={(duration ?? f.slotDurationMinutes) === d} onClick={() => setDuration(d)}>
                  {d >= 60 ? `${d / 60} h` : `${d} min`}
                </button>
              ))}
            </div>
          )}
          <Button size="lg" block onClick={() => book.mutate()} loading={book.isPending}>
            Book {time12(slot.startTime)} • {dayLabel(date)}
          </Button>
        </div>
      )}

      <Sheet open={!!confirmed} onClose={() => setConfirmed(null)}>
        {confirmed && (
          <div className="stack center" style={{ alignItems: 'center' }}>
            <CheckCircle2 size={56} color="var(--success)" />
            <h2>Booking confirmed</h2>
            <div>
              <div className="strong" style={{ fontSize: '1.15rem' }}>{confirmed.facilityName}</div>
              <div className="secondary">{dateLong(confirmed.date)}</div>
              <div className="secondary">{timeRange(confirmed.startTime, confirmed.endTime)}</div>
              <div className="mono small muted mt-1">{confirmed.reference}</div>
            </div>
            <Button block size="lg" onClick={() => setConfirmed(null)}>
              Done
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function MyBookingsPage() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['bookings', scope], queryFn: () => get(`/bookings/mine?scope=${scope}`) });
  const cancel = useMutation({
    mutationFn: (id: string) => post(`/bookings/${id}/cancel`, {}),
    onSuccess: () => {
      toast('Booking cancelled', 'success');
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  return (
    <>
      <MobileHeader title="My bookings" back="/app/facilities" />
      <main className="mobile-main stack">
        <Segmented value={scope} onChange={setScope} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'History' }]} />
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.bookings.length ? (
          <Empty icon={<CalendarCheck size={40} />} title={scope === 'upcoming' ? 'No upcoming bookings' : 'No booking history'}>
            <Link to="/app/facilities">Book a facility</Link>
          </Empty>
        ) : (
          data.bookings.map((b: any) => (
            <Card key={b.id}>
              <div className="between">
                <div>
                  <div className="strong">{b.facilityName}</div>
                  <div className="small secondary">
                    {dayLabel(b.date)} • {timeRange(b.startTime, b.endTime)}
                  </div>
                  <div className="xsmall muted mono">{b.reference}</div>
                </div>
                <Badge tone={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'danger' : ''}>{b.status[0].toUpperCase() + b.status.slice(1)}</Badge>
              </div>
              {b.cancellable && (
                <Button className="mt-2" variant="secondary" size="sm" onClick={() => window.confirm(`Cancel ${b.facilityName} on ${dayLabel(b.date)}?`) && cancel.mutate(b.id)}>
                  Cancel booking
                </Button>
              )}
              {scope === 'upcoming' && !b.cancellable && b.status === 'confirmed' && <p className="xsmall muted mt-1">Cancellation window has passed</p>}
            </Card>
          ))
        )}
      </main>
    </>
  );
}
