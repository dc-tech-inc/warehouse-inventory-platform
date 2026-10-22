import { createHash, randomBytes } from "node:crypto";
import { sessions, users, type Database } from "@app/db";
import type { CreateUserInput, PublicUser, UpdateUserInput } from "@app/shared";
import argon2 from "argon2";
import { asc, eq } from "drizzle-orm";
import { AppError, notFound } from "../middleware/error-handler.js";

// OWASP Password Storage Cheat Sheet minimum for argon2id.
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTIONS);
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

/** 32 random bytes, URL-safe. Only its sha256 is stored, so a leaked sessions table cannot be replayed. */
export const newSessionToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isExpired = (expiresAt: Date, now = new Date()) => expiresAt.getTime() <= now.getTime();

const invalidCredentials = () => new AppError(401, "UNAUTHORIZED", "Invalid credentials");

const publicColumns = { id: users.id, email: users.email, name: users.name, role: users.role };

export interface Credentials {
  email: string;
  password: string;
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(db: Database) {
  // Verified against when the email is unknown, so both login failure paths cost one argon2 verify.
  // Built up front so even the first unknown-email login after startup takes the same time.
  const dummyHash = hashPassword(randomBytes(16).toString("hex"));
  dummyHash.catch(() => {}); // a failure surfaces on the login that awaits it, not as an unhandled rejection

  return {
    /** Accounts are created by an admin (or the seed script); there is no public sign-up. */
    async createUser({ email, name, password, role }: CreateUserInput & { email: string }): Promise<PublicUser> {
      const passwordHash = await hashPassword(password);
      const [user] = await db
        .insert(users)
        .values({ email, name, role, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning(publicColumns);
      if (!user) throw new AppError(409, "CONFLICT", "Email is already registered");
      return user;
    },

    async listUsers(): Promise<PublicUser[]> {
      return db.select(publicColumns).from(users).orderBy(asc(users.email));
    },

    async updateUser(id: string, patch: UpdateUserInput): Promise<PublicUser> {
      const [user] = await db.update(users).set(patch).where(eq(users.id, id)).returning(publicColumns);
      if (!user) throw notFound("User not found");
      return user;
    },

    async login({ email, password }: Credentials): Promise<PublicUser> {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        await verifyPassword(await dummyHash, password);
        throw invalidCredentials();
      }
      if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },

    async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
      const token = newSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
      return { token, expiresAt };
    },

    /** Returns the session's user, or null. Expired sessions are deleted on sight. */
    async resolveSession(token: string): Promise<PublicUser | null> {
      const id = hashToken(token);
      const [row] = await db
        .select({ ...publicColumns, expiresAt: sessions.expiresAt })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, id));
      if (!row) return null;
      if (isExpired(row.expiresAt)) {
        await db.delete(sessions).where(eq(sessions.id, id));
        return null;
      }
      return { id: row.id, email: row.email, name: row.name, role: row.role };
    },

    async deleteSession(token: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
    },
  };
}
