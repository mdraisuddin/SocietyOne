import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, Car, CheckCircle2, ClipboardList, Delete, Hash, LogIn, LogOut, Package, QrCode, Search, ShieldCheck, Truck, UserPlus, Users, Wifi, WifiOff, XCircle, Clock, HardHat, Home } from 'lucide-react';
import { ApiError, get, post } from '../../lib/api';
import { useLogout, useSession } from '../../lib/session';
import { cacheGet, cacheSet, dismissQueued, sendOrQueue, useOnline, useQueue } from '../../lib/offline';
import { CATEGORY_LABEL, clock, relative, time12, timeRange } from '../../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, MobileInput, useToast } from '../../components/ui';

// ---------------------------------------------------------------------------
// Gate selection (persisted per device)
// ---------------------------------------------------------------------------
function useGate() {
  const me = useSession();
  const [gateId, setGateId] = useState<string>(() => {
    try {
      return localStorage.getItem('so_gate') || me.defaultGateId || me.gates[0]?.id || '';
    } catch {
      return me.defaultGateId || me.gates[0]?.id || '';
    }
  });
  const update = (id: string) => {
    setGateId(id);
    try {
      localStorage.setItem('so_gate', id);
    } catch {
      /* ignore */
    }
  };
  return { gateId, setGateId: update, gateName: me.gates.find((g) => g.id === gateId)?.name ?? 'Gate' };
}

/** Cached list of today's expected visitors — lets OTP verification work offline. */
function useExpected() {
  const online = useOnline();
  const q = useQuery({
    queryKey: ['gate-expected'],
    queryFn: async () => {
      const data = await get('/gate/expected');
      cacheSet('gate-expected', data);
      return data;
    },
    refetchInterval: 120_000,
    enabled: online,
    initialData: () => cacheGet<any>('gate-expected')?.value,
  });
  return q.data as any;
}

export default function GuardApp() {
  const me = useSession();
  const online = useOnline();
  const queue = useQueue();
  const logout = useLogout();
  const gate = useGate();
  useExpected();
  return (
    <div className="guard-shell">
      <header className="guard-header">
        <Link to="/guard" className="row" style={{ color: '#fff', textDecoration: 'none' }} aria-label="Security home">
          <ShieldCheck size={26} />
          <div>
            <div className="strong">SocietyOne Security</div>
            <div className="xsmall muted">
              {me.user.fullName} • {me.society?.name}
            </div>
          </div>
        </Link>
        <div className="grow" />
        <select value={gate.gateId} onChange={(e) => gate.setGateId(e.target.value)} aria-label="Current gate">
          {me.gates.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <span className="row small" title={online ? 'Online' : 'Offline'} aria-label={online ? 'Online' : 'Offline'}>
          {online ? <Wifi size={20} /> : <WifiOff size={20} color="#ffb4b4" />}
        </span>
        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)' }} onClick={logout}>
          <LogOut size={16} />
          <span className="hide-mobile">Sign out</span>
        </button>
      </header>
      {!online && <div className="offline-bar">Offline mode — entries are saved on this device and will sync automatically.</div>}
      {queue.length > 0 && <QueueBar />}
      <main className="guard-main">
        <Routes>
          <Route index element={<GuardHome />} />
          <Route path="scan" element={<ScanPage gateId={gate.gateId} />} />
          <Route path="passcode" element={<PasscodePage gateId={gate.gateId} />} />
          <Route path="search" element={<SearchPage gateId={gate.gateId} />} />
          <Route path="new" element={<NewVisitorPage gateId={gate.gateId} />} />
          <Route path="approvals/:id" element={<ApprovalWaitPage gateId={gate.gateId} />} />
          <Route path="quick/:category" element={<QuickEntryPage gateId={gate.gateId} gateName={gate.gateName} />} />
          <Route path="inside" element={<InsidePage gateId={gate.gateId} />} />
          <Route path="activity" element={<ActivityPage />} />
        </Routes>
      </main>
    </div>
  );
}

function QueueBar() {
  const queue = useQueue();
  const pending = queue.filter((q) => !q.lastError);
  const failed = queue.filter((q) => q.lastError);
  return (
    <div style={{ padding: '10px 18px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
      {pending.length > 0 && (
        <div className="row small strong">
          <Clock size={16} /> {pending.length} entr{pending.length === 1 ? 'y' : 'ies'} waiting to sync
        </div>
      )}
      {failed.map((f) => (
        <div key={f.id} className="between small mt-1" style={{ color: 'var(--danger)' }}>
          <span>
            Not saved: {f.label} — {f.lastError}
          </span>
          <Button size="sm" variant="secondary" onClick={() => dismissQueued(f.id)}>
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}

function BackBar({ title }: { title: string }) {
  const nav = useNavigate();
  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <button className="icon-btn" aria-label="Back" onClick={() => nav('/guard')}>
        <ArrowLeft size={20} />
      </button>
      <h1 style={{ fontSize: '1.35rem' }}>{title}</h1>
    </div>
  );
}

function Tile({ to, icon, label, sub, primary, tone }: { to: string; icon: ReactNode; label: string; sub?: ReactNode; primary?: boolean; tone?: string }) {
  return (
    <Link to={to} className={`guard-tile ${primary ? 'primary' : ''}`}>
      <span className={`gt-icon ${tone ?? ''}`}>{icon}</span>
      <span>
        {label}
        {sub && <small>{sub}</small>}
      </span>
    </Link>
  );
}

function GuardHome() {
  const expected = useExpected();
  const inside = useQuery({ queryKey: ['gate-inside'], queryFn: () => get('/gate/inside'), refetchInterval: 30_000 });
  const approvals = useQuery({ queryKey: ['gate-approvals'], queryFn: () => get('/gate/approvals'), refetchInterval: 8_000 });
  const pendingCount = expected?.invites?.filter((i: any) => !i.insideNow && i.status === 'active').length ?? 0;
  return (
    <div className="stack-lg">
      <div className="guard-tiles">
        <Tile to="/guard/scan" icon={<QrCode size={30} />} label="Scan QR" sub="Visitor pass" primary />
        <Tile to="/guard/passcode" icon={<Hash size={30} />} label="Enter passcode" sub="6-digit code" primary />
        <Tile to="/guard/search" icon={<Search size={28} />} label="Search" sub="Flat, name, mobile, pass" tone="qa-blue" />
        <Tile to="/guard/new" icon={<UserPlus size={28} />} label="New visitor" sub="Ask resident to approve" tone="qa-amber" />
        <Tile to="/guard/quick/food_delivery" icon={<Bike size={28} />} label="Food delivery" sub="Swiggy, Zomato…" tone="qa-green" />
        <Tile to="/guard/quick/delivery" icon={<Package size={28} />} label="Delivery" sub="Amazon, Flipkart, Blinkit…" tone="qa-green" />
        <Tile to="/guard/quick/courier" icon={<Truck size={28} />} label="Courier" tone="qa-green" />
        <Tile to="/guard/quick/cab" icon={<Car size={28} />} label="Cab / Taxi" sub="Uber, Ola, Rapido" tone="qa-info" />
        <Tile to="/guard/quick/domestic_staff" icon={<HardHat size={28} />} label="Domestic staff" sub="Maid, cook, driver" tone="qa-violet" />
        <Tile to="/guard/inside" icon={<Users size={28} />} label="Inside now" sub={`${inside.data?.inside?.length ?? '–'} people`} tone="qa-blue" />
        <Tile to="/guard/activity" icon={<ClipboardList size={28} />} label="Today’s log" tone="qa-info" />
        <Tile to="/guard/search" icon={<Clock size={28} />} label="Expected today" sub={`${pendingCount} yet to arrive`} tone="qa-amber" />
      </div>

      {approvals.data?.approvals?.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 10 }}>Approval requests</h2>
          <div className="card card-flush list">
            {approvals.data.approvals.map((a: any) => (
              <Link key={a.id} to={`/guard/approvals/${a.id}`} className="list-item">
                <div className="grow">
                  <div className="strong">{a.visitorName}</div>
                  <div className="small muted">
                    {a.flatNumber} • {relative(a.createdAt)}
                  </div>
                </div>
                <ApprovalStatus status={a.status} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ marginBottom: 10 }}>Expected today</h2>
        {!expected ? (
          <Loading />
        ) : !expected.invites.length ? (
          <Empty title="No pre-approved visitors today" />
        ) : (
          <div className="card card-flush list">
            {expected.invites.slice(0, 12).map((i: any) => (
              <Link key={i.id} to={`/guard/search?pass=${i.passCode}`} className="list-item">
                <div className="grow">
                  <div className="strong">{i.visitorName}</div>
                  <div className="small muted">
                    {i.towerName} • {i.flatNumber} • Expected {time12(i.expectedArrival)}
                  </div>
                </div>
                {i.insideNow ? <Badge tone="success">Inside</Badge> : <Badge tone="primary">{timeRange(i.windowStart, i.windowEnd)}</Badge>}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const ApprovalStatus = ({ status }: { status: string }) =>
  status === 'approved' ? <Badge tone="success">Approved</Badge> : status === 'rejected' ? <Badge tone="danger">Rejected</Badge> : status === 'pending' ? <Badge tone="warning">Waiting…</Badge> : <Badge>{status}</Badge>;

// ---------------------------------------------------------------------------
// Verification result + check in
// ---------------------------------------------------------------------------
function VerifyResult({ invite, gateId, onDone, offline }: { invite: any; gateId: string; onDone: () => void; offline?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const ok = invite.validity?.valid;
  const doCheckIn = async () => {
    setBusy(true);
    try {
      const r = await sendOrQueue(`/gate/invites/${invite.id}/check-in`, { gateId }, `Check-in ${invite.visitorName}`);
      toast(r.status === 'queued' ? `Saved offline: ${invite.visitorName} checked in` : `${invite.visitorName} checked in`, 'success');
      qc.invalidateQueries({ queryKey: ['gate-inside'] });
      qc.invalidateQueries({ queryKey: ['gate-expected'] });
      onDone();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const doCheckOut = async () => {
    setBusy(true);
    try {
      const r = await sendOrQueue(`/gate/entries/${invite.activeEntryId}/check-out`, { gateId }, `Check-out ${invite.visitorName}`);
      toast(r.status === 'queued' ? 'Saved offline: checked out' : `${invite.visitorName} checked out`, 'success');
      qc.invalidateQueries({ queryKey: ['gate-inside'] });
      onDone();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`verify-card ${ok ? 'ok' : invite.validity?.canCheckOut ? '' : 'bad'}`}>
      <div className="big-status" style={{ color: ok ? 'var(--success)' : invite.validity?.canCheckOut ? 'var(--info)' : 'var(--danger)' }}>
        {ok ? <CheckCircle2 size={26} /> : invite.validity?.canCheckOut ? <Users size={26} /> : <XCircle size={26} />}
        {ok ? 'Valid pass' : invite.validity?.reason}
      </div>
      <div className="verify-name mt-2">{invite.visitorName}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 650 }}>
        {invite.towerName} • {invite.flatNumber}
      </div>
      <div className="secondary mt-1">
        Expected {time12(invite.expectedArrival)} • {invite.guestCount} {invite.guestCount > 1 ? 'people' : 'person'}
        {invite.vehicleNumber ? ` • ${invite.vehicleNumber}` : ''}
      </div>
      <div className="small muted">
        {invite.passCode} • {invite.purpose}
        {offline ? ' • verified offline' : ''}
      </div>
      <div className="stack mt-3">
        {ok && (
          <Button size="xl" variant="success" block onClick={doCheckIn} loading={busy}>
            <LogIn size={24} /> CHECK IN
          </Button>
        )}
        {invite.validity?.canCheckOut && invite.activeEntryId && (
          <Button size="xl" block onClick={doCheckOut} loading={busy}>
            <LogOut size={24} /> CHECK OUT
          </Button>
        )}
        {!ok && !invite.validity?.canCheckOut && (
          <Link to="/guard/new" className="btn btn-lg btn-secondary btn-block">
            Request resident approval instead
          </Link>
        )}
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Offline fallback: validate a passcode against today's cached list. */
function offlineLookup(expected: any, code: string) {
  const inv = expected?.invites?.find((i: any) => i.otp === code || i.passCode === code || i.passCode === `VIS-${code}`);
  if (!inv) return null;
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const inWindow = now >= inv.windowStart && now <= inv.windowEnd;
  return {
    ...inv,
    validity: inv.insideNow
      ? { valid: false, reason: 'Visitor is already inside', canCheckOut: true }
      : inWindow
        ? { valid: true }
        : { valid: false, reason: `Pass is valid between ${inv.windowStart} and ${inv.windowEnd}` },
  };
}

function PasscodePage({ gateId }: { gateId: string }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const expected = useExpected();
  const verify = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post('/gate/verify', { otp: c });
      setOffline(false);
      setResult(r.invite);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        const hit = offlineLookup(expected, c);
        if (hit) {
          setOffline(true);
          setResult(hit);
        } else setError(new Error('Offline and this code is not in today’s saved list. Use “New visitor” when back online.'));
      } else setError(e);
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => {
    if (code.length >= 6) return;
    const next = code + d;
    setCode(next);
    if (next.length === 6) verify(next);
  };
  if (result)
    return (
      <>
        <BackBar title="Visitor pass" />
        <VerifyResult invite={result} gateId={gateId} offline={offline} onDone={() => (setResult(null), setCode(''))} />
      </>
    );
  return (
    <>
      <BackBar title="Enter passcode" />
      <div className="stack-lg" style={{ maxWidth: 420, margin: '0 auto' }}>
        <div className="otp-display" aria-live="polite" aria-label={`Entered ${code.length} of 6 digits`}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={code[i] ? 'filled' : ''}>
              {code[i] ?? ''}
            </span>
          ))}
        </div>
        <input className="sr-only" inputMode="numeric" aria-label="Passcode" value={code} onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(v);
          if (v.length === 6) verify(v);
        }} />
        {busy && <Loading />}
        <ErrorBox error={error} />
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" onClick={() => (setCode(''), setError(null))} aria-label="Clear" style={{ fontSize: '1rem' }}>
            Clear
          </button>
          <button type="button" onClick={() => press('0')}>
            0
          </button>
          <button type="button" onClick={() => setCode(code.slice(0, -1))} aria-label="Delete">
            <Delete size={24} />
          </button>
        </div>
      </div>
    </>
  );
}

function ScanPage({ gateId }: { gateId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const scanning = useRef(true);
  const verify = async (token: string) => {
    scanning.current = false;
    try {
      const r = await post('/gate/verify', { qr: token });
      setResult(r.invite);
    } catch (e) {
      setError(e);
      setTimeout(() => ((scanning.current = true), setError(null)), 2500);
    }
  };
  useEffect(() => {
    if (result) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const detector = 'BarcodeDetector' in window ? new (window as any).BarcodeDetector({ formats: ['qr_code'] }) : null;
    (async () => {
      try {
        // jsQR (~130 KB) is only downloaded on devices without the native BarcodeDetector API.
        const jsQR = detector ? null : (await import('jsqr')).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          const v = videoRef.current;
          if (!v || cancelled) return;
          if (scanning.current && v.readyState >= 2) {
            let text: string | null = null;
            if (detector) {
              const codes = await detector.detect(v).catch(() => []);
              text = codes[0]?.rawValue ?? null;
            } else {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              const ctx2d = canvas.getContext('2d', { willReadFrequently: true })!;
              ctx2d.drawImage(v, 0, 0);
              const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR?.(img.data, img.width, img.height)?.data ?? null;
            }
            if (text) verify(text);
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCamError('Camera not available. Allow camera access, or enter the passcode instead.');
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  if (result)
    return (
      <>
        <BackBar title="Visitor pass" />
        <VerifyResult invite={result} gateId={gateId} onDone={() => ((scanning.current = true), setResult(null))} />
      </>
    );
  return (
    <>
      <BackBar title="Scan visitor QR" />
      <div className="stack" style={{ maxWidth: 460, margin: '0 auto' }}>
        {camError ? (
          <div className="alert alert-warning">{camError}</div>
        ) : (
          <div className="scanner">
            <video ref={videoRef} playsInline muted />
            <div className="frame" />
          </div>
        )}
        <ErrorBox error={error} />
        <p className="center muted small">Hold the visitor’s QR code inside the frame</p>
        <form className="row" onSubmit={(e) => (e.preventDefault(), manual && verify(manual))}>
          <input className="input" placeholder="Or paste QR text (scanner devices)" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="QR text" />
          <Button>Verify</Button>
        </form>
        <Link to="/guard/passcode" className="btn btn-secondary btn-lg">
          <Hash size={20} /> Enter passcode instead
        </Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function SearchPage({ gateId }: { gateId: string }) {
  const initial = new URLSearchParams(location.search).get('pass') ?? '';
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [selected, setSelected] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching, error } = useQuery({ queryKey: ['gate-search', debounced], queryFn: () => get(`/gate/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 });
  const qc = useQueryClient();
  const toast = useToast();
  if (selected) return (<><BackBar title="Visitor pass" /><VerifyResult invite={selected} gateId={gateId} onDone={() => (setSelected(null), qc.invalidateQueries({ queryKey: ['gate-search'] }))} /></>);
  const checkOut = async (e: any) => {
    const r = await sendOrQueue(`/gate/entries/${e.id}/check-out`, { gateId }, `Check-out ${e.visitor_name}`).catch((err) => (toast(err.message, 'error'), null));
    if (r) toast(`${e.visitor_name} checked out`, 'success');
    qc.invalidateQueries({ queryKey: ['gate-search'] });
  };
  return (
    <>
      <BackBar title="Search" />
      <div className="stack">
        <Input className="input-lg" autoFocus placeholder="Flat (A-1204), name, mobile or pass" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {isFetching && <Loading />}
        <ErrorBox error={error} />
        {data && (
          <>
            {data.invites.length > 0 && (
              <section>
                <h3 style={{ margin: '6px 0 8px' }}>Visitor passes</h3>
                <div className="card card-flush list">
                  {data.invites.map((i: any) => (
                    <button key={i.id} className="list-item" onClick={() => setSelected(i)}>
                      <div className="grow">
                        <div className="strong">{i.visitorName}</div>
                        <div className="small muted">
                          {i.towerName} • {i.flatNumber} • {time12(i.expectedArrival)} • {i.passCode}
                        </div>
                      </div>
                      {i.validity.valid ? <Badge tone="success">Valid now</Badge> : i.validity.canCheckOut ? <Badge tone="info">Inside</Badge> : <Badge tone="warning">Not now</Badge>}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {data.inside.length > 0 && (
              <section>
                <h3 style={{ margin: '6px 0 8px' }}>Inside now</h3>
                <div className="card card-flush list">
                  {data.inside.map((e: any) => (
                    <div key={e.id} className="list-item">
                      <div className="grow">
                        <div className="strong">{e.visitor_name}</div>
                        <div className="small muted">
                          {e.flat_number ?? '—'} • In {clock(e.checked_in_at)}
                        </div>
                      </div>
                      <Button onClick={() => checkOut(e)}>Check out</Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {data.flats.length > 0 && (
              <section>
                <h3 style={{ margin: '6px 0 8px' }}>Flats</h3>
                <div className="card card-flush list">
                  {data.flats.map((f: any) => (
                    <div key={f.id} className="list-item">
                      <span className="icon-tile qa-blue">
                        <Home size={18} />
                      </span>
                      <div className="grow">
                        <div className="strong">{f.number}</div>
                        <div className="small muted">{f.occupied ? f.residents.join(', ') : 'Vacant'}</div>
                      </div>
                      {f.occupied && (
                        <Button variant="soft" onClick={() => nav(`/guard/new?flat=${f.id}&n=${encodeURIComponent(f.number)}`)}>
                          New visitor
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {!data.invites.length && !data.flats.length && !data.inside.length && <Empty title="No matches">Try the flat number, e.g. A-1204</Empty>}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Flat picker (shared by new visitor + quick entry)
// ---------------------------------------------------------------------------
function FlatPicker({ value, onChange }: { value: { id: string; number: string } | null; onChange: (f: { id: string; number: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({ queryKey: ['gate-search', debounced], queryFn: () => get(`/gate/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 && !value });
  if (value)
    return (
      <div className="card row" style={{ padding: 12 }}>
        <span className="icon-tile qa-blue">
          <Home size={18} />
        </span>
        <span className="grow strong" style={{ fontSize: '1.15rem' }}>
          {value.number}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  return (
    <div className="stack-sm">
      <input className="input input-lg" placeholder="Flat number, e.g. A-1204" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} aria-label="Destination flat" />
      {isFetching && <Loading />}
      {data?.flats?.length > 0 && (
        <div className="card card-flush list">
          {data.flats.map((f: any) => (
            <button key={f.id} type="button" className="list-item" onClick={() => onChange({ id: f.id, number: f.number })} disabled={!f.occupied}>
              <div className="grow">
                <div className="strong">{f.number}</div>
                <div className="small muted">{f.occupied ? f.residents.join(', ') : 'Vacant'}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unexpected visitor → approval request
// ---------------------------------------------------------------------------
const GUARD_PURPOSES = ['Guest', 'Relative', 'Plumber', 'Electrician', 'Carpenter', 'Maintenance', 'Sales', 'Other'];

function NewVisitorPage({ gateId }: { gateId: string }) {
  const params = new URLSearchParams(location.search);
  const nav = useNavigate();
  const [flat, setFlat] = useState<{ id: string; number: string } | null>(params.get('flat') ? { id: params.get('flat')!, number: params.get('n') ?? '' } : null);
  const [f, setF] = useState({ visitorName: '', mobile: '', purpose: '', guestCount: 1, vehicleNumber: '' });
  const create = useMutation({
    mutationFn: () => post('/gate/approvals', { ...f, mobile: f.mobile.replace(/\s/g, '') || null, vehicleNumber: f.vehicleNumber || null, flatId: flat!.id, gateId }),
    onSuccess: (r) => nav(`/guard/approvals/${r.approval.id}`, { replace: true }),
  });
  return (
    <>
      <BackBar title="New visitor" />
      <form className="stack" style={{ maxWidth: 620 }} onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <Input className="input-lg" label="Visitor name" value={f.visitorName} onChange={(e) => setF({ ...f, visitorName: e.target.value })} required maxLength={80} autoFocus />
        <MobileInput label="Mobile number (optional)" value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} />
        <div className="field">
          <span className="label">Destination flat</span>
          <FlatPicker value={flat} onChange={setFlat} />
        </div>
        <div className="field">
          <span className="label">Purpose</span>
          <div className="provider-grid">
            {GUARD_PURPOSES.map((p) => (
              <button key={p} type="button" className="provider" aria-pressed={f.purpose === p} onClick={() => setF({ ...f, purpose: p })}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-2">
          <Input label="People" type="number" min={1} max={50} value={f.guestCount} onChange={(e) => setF({ ...f, guestCount: Number(e.target.value) || 1 })} />
          <Input label="Vehicle (optional)" value={f.vehicleNumber} onChange={(e) => setF({ ...f, vehicleNumber: e.target.value.toUpperCase() })} />
        </div>
        <ErrorBox error={create.error} />
        <Button size="xl" block loading={create.isPending} disabled={!flat || !f.purpose || !f.visitorName}>
          Request approval
        </Button>
      </form>
    </>
  );
}

function ApprovalWaitPage({ gateId }: { gateId: string }) {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ['gate-approval', id],
    queryFn: () => get(`/gate/approvals/${id}`),
    refetchInterval: (q) => ((q.state.data as any)?.approval?.status === 'pending' ? 3000 : false),
  });
  const checkIn = useMutation({
    mutationFn: () => post(`/gate/approvals/${id}/check-in`, { gateId }),
    onSuccess: (r) => {
      toast(`${r.entry.visitorName} checked in`, 'success');
      qc.invalidateQueries({ queryKey: ['gate-approvals'] });
      qc.invalidateQueries({ queryKey: ['gate-inside'] });
      nav('/guard');
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  const cancel = useMutation({ mutationFn: () => post(`/gate/approvals/${id}/cancel`), onSuccess: () => nav('/guard') });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const a = data.approval;
  return (
    <>
      <BackBar title="Visitor approval" />
      <div className={`verify-card ${a.status === 'approved' ? 'ok' : a.status === 'pending' ? '' : 'bad'}`} style={{ maxWidth: 620 }}>
        <div className="verify-name">{a.visitorName}</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 650 }}>
          {a.flatNumber} • {a.purpose}
        </div>
        <div className="mt-3">
          {a.status === 'pending' && (
            <div className="big-status pulse" style={{ color: 'var(--warning)' }}>
              <Clock size={26} /> Waiting for resident to respond…
            </div>
          )}
          {a.status === 'approved' && (
            <div className="big-status" style={{ color: 'var(--success)' }}>
              <CheckCircle2 size={26} /> Approved{a.respondedBy ? ` by ${a.respondedBy}` : ''}
            </div>
          )}
          {a.status === 'rejected' && (
            <div className="big-status" style={{ color: 'var(--danger)' }}>
              <XCircle size={26} /> Rejected — do not allow entry
            </div>
          )}
          {(a.status === 'expired' || a.status === 'cancelled') && (
            <div className="big-status" style={{ color: 'var(--text-3)' }}>
              <XCircle size={26} /> Request {a.status}. Ask the resident to call the gate.
            </div>
          )}
        </div>
        <div className="stack mt-3">
          {a.status === 'approved' && !a.entryId && (
            <Button size="xl" variant="success" block onClick={() => checkIn.mutate()} loading={checkIn.isPending}>
              <LogIn size={24} /> CHECK IN
            </Button>
          )}
          {a.entryId && <div className="alert alert-success">Already checked in.</div>}
          {a.status === 'pending' && (
            <Button variant="secondary" onClick={() => cancel.mutate()}>
              Cancel request
            </Button>
          )}
          <Link className="btn btn-ghost" to="/guard">
            Back to home
          </Link>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Quick entries (delivery / cab / courier / staff)
// ---------------------------------------------------------------------------
const PROVIDERS: Record<string, string[]> = {
  food_delivery: ['Swiggy', 'Zomato', 'Other'],
  delivery: ['Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'BigBasket', 'Other'],
  courier: ['Blue Dart', 'Delhivery', 'DTDC', 'India Post', 'Other'],
  cab: ['Uber', 'Ola', 'Rapido', 'Other'],
  domestic_staff: [],
};
const TITLES: Record<string, string> = { food_delivery: 'Food delivery', delivery: 'Delivery', courier: 'Courier', cab: 'Cab / Taxi', domestic_staff: 'Domestic staff' };

function QuickEntryPage({ gateId, gateName }: { gateId: string; gateName: string }) {
  const { category = 'delivery' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [provider, setProvider] = useState('');
  const [flat, setFlat] = useState<{ id: string; number: string } | null>(null);
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [leaveAtGate, setLeaveAtGate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isStaff = category === 'domestic_staff';
  const isCab = category === 'cab';
  const submit = async () => {
    setBusy(true);
    setError(null);
    const clientRef = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const r = await sendOrQueue(
        '/gate/entries/quick',
        { category, provider: provider || null, flatId: flat?.id ?? null, visitorName: name || null, vehicleNumber: vehicle || null, gateId, leaveAtGate, clientRef },
        `${provider || TITLES[category]} → ${flat?.number ?? gateName}`,
      );
      if (r.status === 'sent' && r.data.requiresApproval) {
        nav(`/guard/approvals/${r.data.approvalId}`);
        return;
      }
      toast(r.status === 'queued' ? 'Saved offline — will sync' : flat ? `Recorded. ${flat.number} has been notified.` : 'Entry recorded', 'success');
      qc.invalidateQueries({ queryKey: ['gate-inside'] });
      nav('/guard');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackBar title={TITLES[category] ?? 'Entry'} />
      <div className="stack" style={{ maxWidth: 720 }}>
        {PROVIDERS[category]?.length > 0 && (
          <div className="field">
            <span className="label">Provider</span>
            <div className="provider-grid">
              {PROVIDERS[category].map((p) => (
                <button key={p} type="button" className="provider" aria-pressed={provider === p} onClick={() => setProvider(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {isStaff && <Input className="input-lg" label="Staff name" placeholder="e.g. Saroja (Maid)" value={name} onChange={(e) => setName(e.target.value)} />}
        <div className="field">
          <span className="label">{isCab ? 'Picking up / dropping at flat (optional)' : 'Destination flat'}</span>
          <FlatPicker value={flat} onChange={setFlat} />
        </div>
        {(isCab || category === 'courier') && <Input label="Vehicle number (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />}
        {['delivery', 'courier', 'food_delivery'].includes(category) && (
          <label className="checkbox card" style={{ padding: 14 }}>
            <input type="checkbox" checked={leaveAtGate} onChange={(e) => setLeaveAtGate(e.target.checked)} />
            Parcel left at the gate (delivery agent not entering)
          </label>
        )}
        <ErrorBox error={error} />
        <Button size="xl" block onClick={submit} loading={busy} disabled={(!isCab && !flat) || (isStaff && !name) || (!isStaff && !provider)}>
          {leaveAtGate ? 'Record & notify resident' : 'Allow entry & notify'}
        </Button>
      </div>
    </>
  );
}

function InsidePage({ gateId }: { gateId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['gate-inside'], queryFn: () => get('/gate/inside'), refetchInterval: 30_000 });
  const [filter, setFilter] = useState('');
  const checkOut = async (e: any) => {
    try {
      const r = await sendOrQueue(`/gate/entries/${e.id}/check-out`, { gateId }, `Check-out ${e.visitor_name}`);
      toast(r.status === 'queued' ? 'Saved offline' : `${e.visitor_name} checked out`, 'success');
      qc.setQueryData(['gate-inside'], (old: any) => old && { inside: old.inside.filter((x: any) => x.id !== e.id) });
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const rows = (data?.inside ?? []).filter((e: any) => !filter || `${e.visitor_name} ${e.flat_number ?? ''} ${e.vehicle_number ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <BackBar title={`Inside now (${data?.inside?.length ?? 0})`} />
      <div className="stack">
        <Input placeholder="Filter by name, flat or vehicle" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" />
        {isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty title="Nobody is checked in" />
        ) : (
          <div className="card card-flush list">
            {rows.map((e: any) => (
              <div key={e.id} className="list-item">
                <div className="grow">
                  <div className="strong">{e.visitor_name}</div>
                  <div className="small muted">
                    {CATEGORY_LABEL[e.category]} • {e.flat_number ?? '—'} • In {clock(e.checked_in_at)} • {e.gate_name}
                  </div>
                </div>
                <Button size="lg" onClick={() => checkOut(e)}>
                  <LogOut size={18} /> Out
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ActivityPage() {
  const { data, isLoading } = useQuery({ queryKey: ['gate-recent'], queryFn: () => get('/gate/entries/recent'), refetchInterval: 30_000 });
  return (
    <>
      <BackBar title="Last 24 hours" />
      {isLoading ? (
        <Loading />
      ) : (
        <Card className="card-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Visitor</th>
                  <th>Type</th>
                  <th>Flat</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Gate</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e: any) => (
                  <tr key={e.id}>
                    <td className="strong">{e.visitor_name}</td>
                    <td>{CATEGORY_LABEL[e.category]}</td>
                    <td>{e.flat_number ?? '—'}</td>
                    <td>{clock(e.checked_in_at)}</td>
                    <td>{e.status === 'inside' ? <Badge tone="success">Inside</Badge> : e.status === 'left_at_gate' ? 'At gate' : clock(e.checked_out_at)}</td>
                    <td>{e.gate_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
