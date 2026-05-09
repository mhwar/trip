// Authentication function — handles owner/team login, sessions, invites
// Storage:
//   auth-users    : key=email          → { email, passwordHash, salt, role, createdAt }
//   auth-sessions : key=sessionToken   → { email, role, expiresAt }
//   auth-invites  : key=inviteToken    → { email, role, expiresAt, invitedBy }
//
// Bootstrap: OWNER_EMAIL and OWNER_PASSWORD env vars create the owner on first login.

const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const INVITE_TTL_MS  =  7 * 24 * 60 * 60 * 1000;  // 7 days
const PBKDF2_ITER    = 120000;
const PBKDF2_KEYLEN  = 32;
const PBKDF2_DIGEST  = "sha256";

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const key  = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return { salt: salt.toString("hex"), passwordHash: key.toString("hex") };
}

function verifyPassword(password, saltHex, hashHex) {
  const { passwordHash } = hashPassword(password, saltHex);
  return crypto.timingSafeEqual(Buffer.from(passwordHash, "hex"), Buffer.from(hashHex, "hex"));
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function getUser(usersStore, email) {
  return await usersStore.get(email, { type: "json" });
}

async function ensureOwnerBootstrap(usersStore) {
  const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL || "info@mhwar.sa");
  const ownerPwd   = process.env.OWNER_PASSWORD;
  if (!ownerPwd) return null; // no bootstrap configured
  const existing = await getUser(usersStore, ownerEmail);
  if (existing) return existing;
  const { salt, passwordHash } = hashPassword(ownerPwd);
  const user = {
    email: ownerEmail,
    passwordHash,
    salt,
    role: "owner",
    createdAt: new Date().toISOString()
  };
  await usersStore.setJSON(ownerEmail, user);
  return user;
}

async function getSession(sessionsStore, token) {
  if (!token) return null;
  const s = await sessionsStore.get(token, { type: "json" });
  if (!s) return null;
  if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) {
    try { await sessionsStore.delete(token); } catch {}
    return null;
  }
  return s;
}

function getBearer(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)/i);
  return m ? m[1] : null;
}

exports.handler = async (event) => {
  const action = (event.queryStringParameters?.action || "").toLowerCase();
  const usersStore    = getStore("auth-users");
  const sessionsStore = getStore("auth-sessions");
  const invitesStore  = getStore("auth-invites");

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { return json(400, { error: "Invalid JSON" }); }
  }

  // ─── login ──────────────────────────────────────────────────────────────
  if (action === "login" && event.httpMethod === "POST") {
    const email = normalizeEmail(body.email);
    const pwd   = String(body.password || "");
    if (!email || !pwd) return json(400, { error: "missing email/password" });

    await ensureOwnerBootstrap(usersStore);
    const user = await getUser(usersStore, email);
    if (!user) return json(401, { error: "invalid credentials" });

    let ok = false;
    try { ok = verifyPassword(pwd, user.salt, user.passwordHash); } catch {}
    if (!ok) return json(401, { error: "invalid credentials" });

    const token = newToken();
    const session = {
      email: user.email,
      role:  user.role,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    };
    await sessionsStore.setJSON(token, session);
    return json(200, { ok: true, token, user: { email: user.email, role: user.role } });
  }

  // ─── me ─────────────────────────────────────────────────────────────────
  if (action === "me" && event.httpMethod === "GET") {
    const token = getBearer(event);
    const session = await getSession(sessionsStore, token);
    if (!session) return json(401, { error: "not authenticated" });
    return json(200, { ok: true, user: { email: session.email, role: session.role } });
  }

  // ─── logout ─────────────────────────────────────────────────────────────
  if (action === "logout" && event.httpMethod === "POST") {
    const token = getBearer(event);
    if (token) { try { await sessionsStore.delete(token); } catch {} }
    return json(200, { ok: true });
  }

  // ─── invite (owner-only) ───────────────────────────────────────────────
  if (action === "invite" && event.httpMethod === "POST") {
    const token = getBearer(event);
    const session = await getSession(sessionsStore, token);
    if (!session || session.role !== "owner") return json(403, { error: "owner only" });

    const email = normalizeEmail(body.email);
    if (!email) return json(400, { error: "missing email" });

    const role = body.role === "team" ? "team" : "team";
    const inviteToken = newToken();
    await invitesStore.setJSON(inviteToken, {
      email,
      role,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      invitedBy: session.email
    });
    return json(200, { ok: true, inviteToken, email });
  }

  // ─── redeem invite (anyone with valid token) ───────────────────────────
  if (action === "redeem" && event.httpMethod === "POST") {
    const inviteToken = String(body.inviteToken || "");
    const password    = String(body.password || "");
    if (!inviteToken || password.length < 6) return json(400, { error: "missing token or weak password" });

    const invite = await invitesStore.get(inviteToken, { type: "json" });
    if (!invite) return json(404, { error: "invalid or expired invite" });
    if (Date.parse(invite.expiresAt) < Date.now()) {
      try { await invitesStore.delete(inviteToken); } catch {}
      return json(410, { error: "invite expired" });
    }

    const existing = await getUser(usersStore, invite.email);
    if (existing) {
      try { await invitesStore.delete(inviteToken); } catch {}
      return json(409, { error: "user already exists" });
    }

    const { salt, passwordHash } = hashPassword(password);
    const user = {
      email: invite.email,
      passwordHash,
      salt,
      role: invite.role,
      invitedBy: invite.invitedBy,
      createdAt: new Date().toISOString()
    };
    await usersStore.setJSON(invite.email, user);
    try { await invitesStore.delete(inviteToken); } catch {}

    const sessionToken = newToken();
    await sessionsStore.setJSON(sessionToken, {
      email: user.email,
      role:  user.role,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    });
    return json(200, { ok: true, token: sessionToken, user: { email: user.email, role: user.role } });
  }

  // ─── inspect invite (resolve email/role for the redemption form) ───────
  if (action === "invite-info" && event.httpMethod === "GET") {
    const inviteToken = event.queryStringParameters?.token || "";
    const invite = await invitesStore.get(inviteToken, { type: "json" });
    if (!invite) return json(404, { error: "invalid invite" });
    if (Date.parse(invite.expiresAt) < Date.now()) return json(410, { error: "expired" });
    return json(200, { ok: true, email: invite.email, role: invite.role });
  }

  // ─── setup (first-run: only works when zero users exist) ──────────────
  if (action === "setup" && event.httpMethod === "POST") {
    const email = normalizeEmail(body.email);
    const pwd   = String(body.password || "");
    if (!email || pwd.length < 6) return json(400, { error: "email and password (min 6 chars) required" });

    // Check if any user already exists — if yes, reject
    try {
      const list = await usersStore.list();
      if (list.blobs && list.blobs.length > 0) {
        return json(409, { error: "setup already completed — use login instead" });
      }
    } catch {}

    const { salt, passwordHash } = hashPassword(pwd);
    const user = { email, passwordHash, salt, role: "owner", createdAt: new Date().toISOString() };
    await usersStore.setJSON(email, user);

    const token = newToken();
    await sessionsStore.setJSON(token, {
      email,
      role: "owner",
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    });
    return json(200, { ok: true, token, user: { email, role: "owner" } });
  }

  // ─── setup-check (is owner already created?) ──────────────────────────
  if (action === "setup-check" && event.httpMethod === "GET") {
    try {
      const list = await usersStore.list();
      const hasUsers = list.blobs && list.blobs.length > 0;
      return json(200, { needsSetup: !hasUsers });
    } catch {
      return json(200, { needsSetup: true });
    }
  }

  return json(400, { error: "unknown action" });
};

// Export helpers for other functions (save/load/share)
module.exports.getSessionFromEvent = async (event) => {
  const token = getBearer(event);
  if (!token) return null;
  const sessionsStore = getStore("auth-sessions");
  return await getSession(sessionsStore, token);
};
