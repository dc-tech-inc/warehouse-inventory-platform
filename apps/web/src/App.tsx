import { can, type Permission, type PublicUser } from "@app/shared";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api/client";
import { LoginForm } from "./features/auth/LoginForm";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Inventory } from "./features/inventory/Inventory";
import { Movements } from "./features/movements/Movements";
import { People } from "./features/people/People";
import { Purchasing } from "./features/purchasing/Purchasing";

interface Route {
  path: string;
  label: string;
  needs: Permission;
  render: (user: PublicUser) => ReactNode;
}

const ROUTES: Route[] = [
  { path: "/", label: "Overview", needs: "inventory:read", render: () => <Dashboard /> },
  { path: "/inventory", label: "Inventory", needs: "inventory:read", render: (u) => <Inventory role={u.role} /> },
  { path: "/movements", label: "Movements", needs: "movements:create", render: (u) => <Movements role={u.role} /> },
  { path: "/purchasing", label: "Purchasing", needs: "purchasing:read", render: (u) => <Purchasing user={u} /> },
  { path: "/people", label: "People", needs: "rewards:read", render: (u) => <People role={u.role} /> },
];

/** Hash routing keeps the app static-hostable behind any path prefix; no server rewrite rules are needed. */
const currentPath = () => window.location.hash.replace(/^#/, "") || "/";

function useHashPath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

export function App() {
  // undefined = still checking the session cookie, null = signed out.
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const path = useHashPath();

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
  }, []);

  if (user === undefined) return <p className="state" role="status">Loading…</p>;
  if (user === null) return <LoginForm onAuthenticated={setUser} />;

  const allowed = ROUTES.filter((r) => can(user.role, r.needs));
  const active = allowed.find((r) => r.path === path) ?? allowed[0];

  return (
    <>
      <header className="topbar">
        <span className="brand">Warehouse<span className="brand-sub"> inventory platform</span></span>
        <nav aria-label="Main">
          {allowed.map((r) => (
            <a key={r.path} href={`#${r.path}`} aria-current={r === active ? "page" : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <span className="who">
          <span>{user.name}</span> <span className="role">{user.role}</span>
        </span>
        <button type="button" className="ghost" onClick={() => void api.logout().finally(() => setUser(null))}>
          Sign out
        </button>
      </header>
      <main className="page">
        <h1>{active?.label}</h1>
        {active?.render(user)}
      </main>
    </>
  );
}
