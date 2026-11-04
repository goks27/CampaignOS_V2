import * as React from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui";
import { friendly } from "@/components/toast";

function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-ctl bg-accent text-sm font-semibold text-white">C</span>
          <span className="text-[15px] font-semibold">CampaignOS</span>
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

const loginSchema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function LoginPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  if (!loading && session) return <Navigate to={loc.state?.from ?? "/"} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword(v);
    if (error) setError(error.message === "Invalid login credentials" ? "Email or password is incorrect." : friendly(error));
    else navigate(loc.state?.from ?? "/", { replace: true });
  });

  return (
    <AuthFrame title="Sign in" subtitle="Internal workspace. Accounts are created by invitation.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        {error && <p className="text-sm text-st-red">{error}</p>}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Sign in</Button>
        <Link to="/forgot-password" className="text-center text-xs text-text-2 hover:text-text">Forgot password?</Link>
      </form>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email("Enter a valid email") })) });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback` });
    if (error) setError(friendly(error));
    else setSent(true);
  });
  return (
    <AuthFrame title="Reset your password" subtitle="We’ll email you a link to choose a new password.">
      {sent ? (
        <p className="text-sm text-text-2">If an account exists for that email, a reset link is on its way. <Link className="text-accent" to="/login">Back to sign in</Link></p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <Field label="Email" error={form.formState.errors.email?.message}><Input type="email" autoFocus {...form.register("email")} /></Field>
          {error && <p className="text-sm text-st-red">{error}</p>}
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Send reset link</Button>
          <Link to="/login" className="text-center text-xs text-text-2 hover:text-text">Back to sign in</Link>
        </form>
      )}
    </AuthFrame>
  );
}

const pwSchema = z.object({
  password: z.string().min(10, "Use at least 10 characters"),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "Passwords don’t match", path: ["confirm"] });

/** Landing page for invite and password-reset links: the session arrives in the URL, then the user sets a password. */
export function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const linkError = new URLSearchParams(window.location.hash.slice(1)).get("error_description");
  const form = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });

  if (linkError) {
    return <AuthFrame title="This link can’t be used" subtitle={linkError}>
      <p className="text-sm text-text-2">Invite and reset links expire. Ask an Admin to send a new invite, or <Link className="text-accent" to="/forgot-password">request a new reset link</Link>.</p>
    </AuthFrame>;
  }
  if (loading) return <AuthFrame title="Checking your link…"><span /></AuthFrame>;
  if (!session) {
    return <AuthFrame title="Link expired or already used">
      <p className="text-sm text-text-2"><Link className="text-accent" to="/forgot-password">Request a new link</Link> or <Link className="text-accent" to="/login">sign in</Link>.</p>
    </AuthFrame>;
  }
  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(friendly(error));
    else navigate("/", { replace: true });
  });
  return (
    <AuthFrame title="Choose a password" subtitle={`Signed in as ${session.user.email}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label="New password" error={form.formState.errors.password?.message}><Input type="password" autoComplete="new-password" autoFocus {...form.register("password")} /></Field>
        <Field label="Confirm password" error={form.formState.errors.confirm?.message}><Input type="password" autoComplete="new-password" {...form.register("confirm")} /></Field>
        {error && <p className="text-sm text-st-red">{error}</p>}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Save and continue</Button>
        <Button type="button" variant="ghost" onClick={() => navigate("/")}>Skip for now</Button>
      </form>
    </AuthFrame>
  );
}

export function NoAccessPage() {
  const { signOut, me } = useAuth();
  return (
    <AuthFrame title="No access to this workspace"
      subtitle={me?.role === "worker" ? "This is the AI worker’s service account. It can’t use the web app." : "Your account is deactivated or has no role yet. Ask an Admin to give you access."}>
      <Button onClick={() => void signOut()}>Sign out</Button>
    </AuthFrame>
  );
}

export function SetupNeededPage() {
  return (
    <AuthFrame title="Connect to Supabase" subtitle="The app is missing its configuration.">
      <div className="space-y-2 text-sm text-text-2">
        <p>Set these environment variables, then rebuild:</p>
        <pre className="rounded-ctl border border-line bg-side p-2 font-mono text-xs">VITE_SUPABASE_URL=…{"\n"}VITE_SUPABASE_PUBLISHABLE_KEY=…</pre>
        <p>Locally, copy <span className="font-mono text-xs">apps/web/.env.example</span> to <span className="font-mono text-xs">.env.local</span>. On Cloudflare Pages, add them under Settings → Environment variables. See docs/SETUP.md.</p>
      </div>
    </AuthFrame>
  );
}
