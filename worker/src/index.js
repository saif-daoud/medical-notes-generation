const JSON_HEADERS = { "Content-Type": "application/json" };
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(env, origin) {
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(payload, status = 200, headers = JSON_HEADERS) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function cleanText(value, max = 500) {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function base64UrlEncode(bytes) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64Json(obj) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

function fromB64Json(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

async function makeToken(env, payload) {
  const body = b64Json(payload);
  const signature = await hmacSign(env.TOKEN_SECRET || "local-dev-secret", body);
  return `${body}.${signature}`;
}

async function verifyToken(env, token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw new Error("Bad token");
  const expected = await hmacSign(env.TOKEN_SECRET || "local-dev-secret", body);
  if (signature !== expected) throw new Error("Bad token");
  const payload = fromB64Json(body);
  if (payload.exp && Date.now() > payload.exp) throw new Error("Expired token");
  return payload;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeParticipantUid(email) {
  return `P-${(await sha256Hex(String(email || "").trim().toLowerCase())).slice(0, 12)}`;
}

function requireProfile(profile) {
  const years = Number(profile?.years_experience);
  const cleaned = {
    email: cleanText(profile?.email, 320).toLowerCase(),
    name: cleanText(profile?.name, 200),
    role: cleanText(profile?.role, 200),
    institution: cleanText(profile?.institution, 260),
    latest_degree: cleanText(profile?.latest_degree, 200),
    years_experience: years,
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email)) throw new Error("Invalid email");
  if (!cleaned.name || !cleaned.role || !cleaned.institution || !cleaned.latest_degree) throw new Error("Incomplete profile");
  if (!Number.isFinite(years) || years < 0 || years > 80) throw new Error("Invalid years_experience");
  return cleaned;
}

async function upsertParticipant(env, profile) {
  const now = new Date().toISOString();
  const participantUid = await makeParticipantUid(profile.email);

  await env.DB
    .prepare(
      `INSERT INTO participants (
        participant_uid, email, name, role, institution, latest_degree,
        years_experience, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name=excluded.name,
        role=excluded.role,
        institution=excluded.institution,
        latest_degree=excluded.latest_degree,
        years_experience=excluded.years_experience,
        updated_at=excluded.updated_at`,
    )
    .bind(participantUid, profile.email, profile.name, profile.role, profile.institution, profile.latest_degree, profile.years_experience, now, now)
    .run();

  return participantUid;
}

async function listHistory(env, participantUid) {
  const rows = await env.DB
    .prepare("SELECT * FROM responses WHERE participant_uid = ? ORDER BY sequence_index ASC, timestamp_utc ASC")
    .bind(participantUid)
    .all();
  return rows?.results || [];
}

function responseRow(input, participantUid, email, request) {
  const winner = cleanText(input?.winner_choice, 20);
  if (!["left", "right", "tie"].includes(winner)) throw new Error("Invalid winner_choice");

  return {
    id: cleanText(input?.id || crypto.randomUUID(), 240),
    participant_uid: participantUid,
    participant_email: email,
    comparison_id: cleanText(input?.comparison_id, 120),
    sequence_index: Number(input?.sequence_index || 0),
    left_output_id: cleanText(input?.left_output_id, 80),
    right_output_id: cleanText(input?.right_output_id, 80),
    winner_choice: winner,
    selected_output_id: winner === "tie" ? null : cleanText(input?.selected_output_id, 80),
    note: cleanText(input?.note, 5000) || null,
    timestamp_utc: cleanText(input?.timestamp_utc || new Date().toISOString(), 80),
    user_agent: cleanText(input?.user_agent || request.headers.get("user-agent"), 800),
    page_url: cleanText(input?.page_url, 1000),
  };
}

async function upsertResponse(env, row) {
  await env.DB
    .prepare(
      `INSERT INTO responses (
        id, participant_uid, participant_email, comparison_id, sequence_index,
        left_output_id, right_output_id, winner_choice, selected_output_id,
        note, timestamp_utc, user_agent, page_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(participant_uid, comparison_id) DO UPDATE SET
        id=excluded.id,
        participant_email=excluded.participant_email,
        sequence_index=excluded.sequence_index,
        left_output_id=excluded.left_output_id,
        right_output_id=excluded.right_output_id,
        winner_choice=excluded.winner_choice,
        selected_output_id=excluded.selected_output_id,
        note=excluded.note,
        timestamp_utc=excluded.timestamp_utc,
        user_agent=excluded.user_agent,
        page_url=excluded.page_url,
        received_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .bind(
      row.id,
      row.participant_uid,
      row.participant_email,
      row.comparison_id,
      row.sequence_index,
      row.left_output_id,
      row.right_output_id,
      row.winner_choice,
      row.selected_output_id,
      row.note,
      row.timestamp_utc,
      row.user_agent,
      row.page_url,
    )
    .run();
}

async function stats(env) {
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM responses").first();
  const participants = await env.DB.prepare("SELECT COUNT(*) AS n FROM participants").first();
  const comparisons = await env.DB.prepare("SELECT COUNT(DISTINCT comparison_id) AS n FROM responses").first();
  const outputWins = await env.DB
    .prepare("SELECT selected_output_id, COUNT(*) AS n FROM responses WHERE selected_output_id IS NOT NULL GROUP BY selected_output_id ORDER BY n DESC")
    .all();
  const ties = await env.DB.prepare("SELECT COUNT(*) AS n FROM responses WHERE winner_choice = 'tie'").first();

  return {
    total_responses: Number(total?.n || 0),
    total_participants: Number(participants?.n || 0),
    distinct_comparisons: Number(comparisons?.n || 0),
    ties: Number(ties?.n || 0),
    output_wins: outputWins?.results || [],
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(env, origin);
    const allowed = allowedOrigins(env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (allowed.length && !allowed.includes(origin)) return json({ error: "Origin not allowed" }, 403, headers);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({}));

    try {
      if (path.endsWith("/api/session")) {
        const profile = requireProfile(body.profile);
        const participantUid = await upsertParticipant(env, profile);
        const token = await makeToken(env, { participant_uid: participantUid, email: profile.email, exp: Date.now() + TOKEN_TTL_MS });
        return json({ ok: true, participant_id: participantUid, token }, 200, headers);
      }

      if (path.endsWith("/api/history")) {
        const payload = await verifyToken(env, body.token);
        const responses = await listHistory(env, String(payload.participant_uid || ""));
        return json({ ok: true, responses }, 200, headers);
      }

      if (path.endsWith("/api/response")) {
        const payload = await verifyToken(env, body.token);
        const row = responseRow(body.response, String(payload.participant_uid || ""), String(payload.email || ""), request);
        await upsertResponse(env, row);
        return json({ ok: true, id: row.id }, 200, headers);
      }

      if (path.endsWith("/api/stats")) {
        return json({ ok: true, stats: await stats(env) }, 200, headers);
      }

      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      const message = error?.message || "Request failed";
      const status = ["Bad token", "Expired token"].includes(message) ? 401 : 400;
      return json({ error: message }, status, headers);
    }
  },
};
