import { Credentials, CreateUserInput, IdParams, UpdateUserInput, type UserResponse } from "@app/shared";
import { Router, type RequestHandler } from "express";
import { clearSessionCookie, getAuth, guard, requireAuth, setSessionCookie } from "../middleware/auth.js";
import { conflict } from "../middleware/error-handler.js";
import type { AuthService } from "../services/auth-service.js";

interface AuthRouterDeps {
  auth: AuthService;
  secureCookies: boolean;
  /** Applied to the login endpoint only. */
  credentialLimiter: RequestHandler;
}

export function authRouter({ auth, secureCookies, credentialLimiter }: AuthRouterDeps): Router {
  const router = Router();

  router.post("/login", credentialLimiter, async (req, res) => {
    const user = await auth.login(Credentials.parse(req.body));
    const { token } = await auth.createSession(user.id);
    setSessionCookie(res, token, secureCookies);
    res.json({ user } satisfies UserResponse);
  });

  router.post("/logout", requireAuth(auth), async (_req, res) => {
    await auth.deleteSession(getAuth(res).sessionToken);
    clearSessionCookie(res, secureCookies);
    res.status(204).end();
  });

  router.get("/me", requireAuth(auth), (_req, res) => {
    res.json({ user: getAuth(res).user } satisfies UserResponse);
  });

  return router;
}

/** Admin-only account management. There is no public sign-up. */
export function usersRouter({ auth }: { auth: AuthService }): Router {
  const router = Router();

  router.get("/", guard(auth, "users:manage"), async (_req, res) => {
    res.json({ items: await auth.listUsers() });
  });

  router.post("/", guard(auth, "users:manage"), async (req, res) => {
    const input = CreateUserInput.parse(req.body) as ReturnType<typeof CreateUserInput.parse>;
    res.status(201).json({ user: await auth.createUser(input) } satisfies UserResponse);
  });

  router.patch("/:id", guard(auth, "users:manage"), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    const patch = UpdateUserInput.parse(req.body);
    // Changing your own role could remove the last admin.
    if (id === getAuth(res).user.id && patch.role !== undefined) throw conflict("You cannot change your own role");
    res.json({ user: await auth.updateUser(id, patch) } satisfies UserResponse);
  });

  return router;
}
