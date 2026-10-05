import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { ApiError, post } from '../lib/api';
import { Brand, Button, ErrorBox, Input, MobileInput, Segmented } from '../components/ui';
import { useMe } from '../lib/session';

const DEMO_ACCOUNTS = [
  { label: 'Resident — Ananya Sharma (A-1204)', mobile: '98480 12345' },
  { label: 'Security Guard — Ramesh Yadav', mobile: '90000 00003' },
  { label: 'Tenant — Vikram Iyer (B-1204)', mobile: '90000 00004' },
];
const DEMO_ADMINS = [
  { label: 'Society Admin — Kavitha Reddy', email: 'admin@greenmeadows.in', password: 'GreenMeadows@2026' },
  { label: 'SocietyOne Super Admin', email: 'superadmin@societyone.in', password: 'SocietyOne@2026' },
];
const SHOW_DEMO = import.meta.env.VITE_SHOW_DEMO !== 'false';

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-hero">
        <Brand />
        <div>
          <h1>One App. One Community. Everything Connected.</h1>
          <p>Visitors, complaints, facilities and notices for your gated community — simple for residents, secure at the gate, clear for management.</p>
        </div>
        <div className="row small" style={{ opacity: 0.8 }}>
          <ShieldCheck size={18} /> Your data stays within your society. Built for India’s privacy norms.
        </div>
      </aside>
      <main className="auth-form-wrap">
        <div className="auth-form stack-lg">{children}</div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<'otp' | 'email'>('otp');
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: me } = useMe();
  useEffect(() => {
    if (me) nav(me.home, { replace: true });
  }, [me, nav]);
  const onSignedIn = async (home: string) => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    const next = params.get('next');
    nav(next && next.startsWith(home) ? next : home, { replace: true });
  };
  return (
    <AuthLayout>
      <div className="stack-sm">
        <Brand />
        <p className="tagline">One App. One Community. Everything Connected.</p>
      </div>
      <div className="stack-sm">
        <h1>Sign in</h1>
        <p className="secondary">{mode === 'otp' ? 'Residents, owners, tenants and security staff' : 'Society administrators and facility managers'}</p>
      </div>
      <Segmented
        label="Sign-in method"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'otp', label: <span className="row" style={{ gap: 6 }}><Smartphone size={16} /> Mobile OTP</span> },
          { value: 'email', label: <span className="row" style={{ gap: 6 }}><KeyRound size={16} /> Admin login</span> },
        ]}
      />
      {mode === 'otp' ? <OtpLogin onSignedIn={onSignedIn} /> : <EmailLogin onSignedIn={onSignedIn} />}
    </AuthLayout>
  );
}

function OtpLogin({ onSignedIn }: { onSignedIn: (home: string) => void }) {
  const [mobile, setMobile] = useState('');
  const [step, setStep] = useState<'mobile' | 'code'>('mobile');
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = async (m = mobile) => {
    setError(null);
    setLoading(true);
    try {
      const r = await post('/auth/otp/request', { mobile: m });
      setStep('code');
      setCooldown(r.resendInSeconds ?? 30);
      setDemoCode(r.demoCode ?? null);
      setCode('');
    } catch (e) {
      if (e instanceof ApiError && e.details?.retryAfterSeconds) {
        setStep('code');
        setCooldown(e.details.retryAfterSeconds);
      }
      setError(e);
    } finally {
      setLoading(false);
    }
  };
  const verify = async (c = code) => {
    setError(null);
    setLoading(true);
    try {
      const r = await post('/auth/otp/verify', { mobile, code: c });
      onSignedIn(r.home);
    } catch (e) {
      setError(e);
      setLoading(false);
    }
  };

  if (step === 'mobile')
    return (
      <form className="stack" onSubmit={(e) => (e.preventDefault(), request())}>
        <MobileInput value={mobile} onChange={setMobile} autoFocus />
        <ErrorBox error={error} />
        <Button size="lg" block loading={loading} disabled={mobile.replace(/\D/g, '').length !== 10}>
          Get OTP
        </Button>
        <p className="xsmall muted center">We’ll send a 6-digit code by SMS. Standard SMS rates may apply.</p>
        {SHOW_DEMO && (
          <div className="demo-panel stack-sm">
            <div className="xsmall strong muted">DEMO ACCOUNTS — tap to sign in</div>
            {DEMO_ACCOUNTS.map((d) => (
              <button
                type="button"
                key={d.mobile}
                onClick={() => {
                  setMobile(d.mobile);
                  request(d.mobile);
                }}
              >
                <span>{d.label}</span>
                <span className="mono muted">{d.mobile}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    );
  return (
    <form className="stack" onSubmit={(e) => (e.preventDefault(), verify())}>
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setStep('mobile')}>
        <ArrowLeft size={16} /> Change number
      </button>
      <p className="secondary">
        Enter the code sent to <strong>+91 {mobile}</strong>
      </p>
      <input
        className="input input-otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6-digit OTP"
        maxLength={6}
        value={code}
        autoFocus
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(v);
          if (v.length === 6) verify(v);
        }}
      />
      {demoCode && (
        <div className="alert alert-info">
          <span>
            Demo mode: your code is <strong className="mono">{demoCode}</strong>{' '}
            <button type="button" className="btn btn-sm btn-soft" style={{ marginLeft: 6 }} onClick={() => (setCode(demoCode), verify(demoCode))}>
              Use code
            </button>
          </span>
        </div>
      )}
      <ErrorBox error={error} />
      <Button size="lg" block loading={loading} disabled={code.length !== 6}>
        Verify & continue
      </Button>
      <Button type="button" variant="ghost" disabled={cooldown > 0 || loading} onClick={() => request()}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </Button>
    </form>
  );
}

function EmailLogin({ onSignedIn }: { onSignedIn: (home: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await post('/auth/login', creds ?? { email, password });
      onSignedIn(r.home);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };
  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await post('/auth/password/forgot', { email });
      setSent(r.message);
      setDemoToken(r.demoToken ?? null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  if (forgot)
    return (
      <form className="stack" onSubmit={sendReset}>
        <Input label="Admin email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <ErrorBox error={error} />
        {sent && <div className="alert alert-success">{sent}</div>}
        {demoToken && (
          <div className="alert alert-info">
            Demo mode: <Link to={`/reset-password?token=${demoToken}`}>open the reset link</Link>
          </div>
        )}
        <Button size="lg" block loading={loading}>
          Send reset link
        </Button>
        <Button type="button" variant="ghost" onClick={() => setForgot(false)}>
          Back to sign in
        </Button>
      </form>
    );
  return (
    <form className="stack" onSubmit={submit}>
      <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <ErrorBox error={error} />
      <Button size="lg" block loading={loading}>
        Sign in
      </Button>
      <Button type="button" variant="ghost" onClick={() => setForgot(true)}>
        Forgot password?
      </Button>
      {SHOW_DEMO && (
        <div className="demo-panel stack-sm">
          <div className="xsmall strong muted">DEMO ACCOUNTS — tap to sign in</div>
          {DEMO_ADMINS.map((d) => (
            <button type="button" key={d.email} onClick={() => (setEmail(d.email), setPassword(d.password), submit(undefined, d))}>
              <span>{d.label}</span>
              <span className="muted xsmall">{d.email}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(new Error('Passwords do not match'));
    setLoading(true);
    setError(null);
    try {
      await post('/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout>
      <Brand />
      <h1>Set a new password</h1>
      {done ? (
        <div className="stack">
          <div className="alert alert-success">Your password has been updated. Please sign in.</div>
          <Link className="btn btn-lg btn-block" to="/login">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters, with letters and numbers" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <ErrorBox error={error} />
          <Button size="lg" block loading={loading} disabled={!token}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
