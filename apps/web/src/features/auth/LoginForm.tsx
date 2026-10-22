import type { PublicUser } from "@app/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { useAction } from "../../hooks";
import { FormError } from "../../ui";

export function LoginForm({ onAuthenticated }: { onAuthenticated: (user: PublicUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => onAuthenticated(await api.login({ email, password })));
  }

  return (
    <main className="login">
      <form className="panel login-form" onSubmit={submit}>
        <p className="eyebrow">Warehouse &amp; inventory platform</p>
        <h1>Sign in</h1>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <FormError message={error} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small">
          Demo build with synthetic data. Accounts are created by an administrator; the seed script prints the demo
          logins (<code>admin@</code>, <code>manager@</code>, <code>clerk@example.test</code>).
        </p>
      </form>
    </main>
  );
}
