import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { details, stl, png } from "./fixtures.js";
import { DEFAULT_SETTINGS, BAMBU_COLOURS, MAX_BYTES } from "../shared/catalog.js";
import { STORAGE_LIMIT } from "../cloudflare/storage.js";
import { initialiseDatabase } from "../cloudflare/schema.js";
import { networkOf } from "../cloudflare/auth.js";
const PASSWORD = "cloudflare-test-teacher-password";
async function setup(t, { bindings = {}, outbound, staffHeaders = {}, signIn = true } = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: ".cloudflare-build/worker.js",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["PRINTS"],
    bindings: { TEACHER_PASSWORD: PASSWORD, ...bindings },
    ...(outbound ? { outboundService: outbound } : {}),
    serviceBindings: {
      ASSETS: () => new Response("<html>BNTS student app</html>", { headers: { "Content-Type": "text/html" } }),
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB"),
    bucket = await mf.getR2Bucket("PRINTS");
  await initialiseDatabase(db);
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    folderId: "",
    schools: [{ id: details().schoolId, name: "School A" }],
    staff: [{ id: details().staffId, name: "Alex" }],
    colours: BAMBU_COLOURS.map((c) => c.id),
  };
  await db.prepare("INSERT INTO app_meta(key,value) VALUES (?,?)").bind("settings", JSON.stringify(settings)).run();
  const request = (path, options = {}) => mf.dispatchFetch("https://studio.test/api" + path, options);
  if (!signIn) return { mf, db, bucket, request, settings };
  const login = await request("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://studio.test", ...staffHeaders },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0],
    { csrf } = await login.json();
  const headers = {
    Cookie: cookie,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
    Origin: "https://studio.test",
    ...staffHeaders,
  };
  return { mf, db, bucket, request, headers, settings };
}
async function init(s, overrides = {}, extraHeaders = {}) {
  const data = details(),
    model = stl();
  const response = await s.request("/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://studio.test", ...extraHeaders },
    body: JSON.stringify({
      details: data,
      name: "cube.stl",
      bytes: model.length,
      previewBytes: png.length,
      ...overrides,
    }),
  });
  return { response, body: await response.json(), data, model };
}
async function sendPart(s, pending, kind, bytes) {
  return s.request(`/uploads/${pending.id}/${kind}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + pending.token,
      "Content-Length": String(bytes.length),
      Origin: "https://studio.test",
    },
    body: bytes,
  });
}
test("Cloudflare rejects conflicting colours for one part and retains all selected colour names", async (t) => {
  const s = await setup(t);
  const duplicate = await init(s, {
    details: {
      ...details(),
      colourMapping: [
        { source: "#ABCDEF", target: "Jade White" },
        { source: "#abcdef", target: "Blue" },
      ],
    },
  });
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.body.error, /one colour/);
  const saved = await submit(s, {
    details: {
      ...details(),
      colourMapping: [
        { source: "#abcdef", target: "Jade White" },
        { source: "#123456", target: "Blue" },
      ],
    },
  });
  assert.match(saved.receipt.filename, /^School-A_WHITE_BLUE_\d{4}-\d\d-\d\d_Mia\.stl$/);
});
async function submit(s, overrides = {}) {
  const p = await init(s, overrides);
  assert.equal(p.response.status, 200, JSON.stringify(p.body));
  for (const [kind, data] of [
    ["model", p.model],
    ["preview", png],
  ]) {
    const response = await sendPart(s, p.body, kind, data);
    assert.equal(response.status, 200, await response.text());
  }
  const response = await s.request(`/uploads/${p.body.id}/complete`, {
    method: "POST",
    headers: { Authorization: "Bearer " + p.body.token, Origin: "https://studio.test" },
  });
  assert.equal(response.status, 201);
  return { ...p, receipt: await response.json() };
}
test("Cloudflare serves the app, exposes 50 MB config, and requires teacher auth and CSRF", async (t) => {
  const s = await setup(t);
  const config = await s.request("/config").then((r) => r.json());
  assert.equal(config.uploadMode, "cloudflare");
  assert.equal(config.maxBytes, MAX_BYTES);
  assert.equal(config.studentLookupSupported, true);
  assert.equal((await s.request("/admin/submissions")).status, 401);
  assert.equal(
    (await s.request("/admin/settings", { method: "PUT", headers: { Cookie: s.headers.Cookie }, body: "{}" })).status,
    403,
  );
  assert.equal(
    (await s.request("/admin/login", { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" })).status,
    403,
  );
  const page = await s.mf.dispatchFetch("https://studio.test/teacher");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("X-Robots-Tag"), /noindex/);
});
test("direct uploads are private, completed exactly once, downloadable and have editable status", async (t) => {
  const s = await setup(t),
    result = await submit(s);
  const row = await s.db.prepare("SELECT * FROM submissions WHERE id=?").bind(result.body.id).first();
  assert.equal(row.state, "ready");
  assert.match(row.model_key, /^submissions\/School-A--.*\/\d{4}-\d\d-\d\d\/[a-f\d-]+\/School-A_BLUE_/);
  assert.equal((await s.request(`/admin/submissions/${row.id}/model`)).status, 401);
  const downloaded = await s.request(`/admin/submissions/${row.id}/download`, { headers: s.headers });
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), result.model);
  assert.match(downloaded.headers.get("Content-Disposition"), /attachment/);
  const retry = await init(s, { details: result.data });
  assert(retry.body.receipt);
  assert.equal(retry.body.receipt.id, row.id);
  const patch = await s.request(`/admin/submissions/${row.id}`, {
    method: "PATCH",
    headers: s.headers,
    body: JSON.stringify({ status: "printed" }),
  });
  assert.equal((await patch.json()).record.status, "printed");
  const remove = await s.request(`/admin/submissions/${row.id}`, { method: "DELETE", headers: s.headers });
  assert.equal(remove.status, 200);
  assert.equal(await s.bucket.head(row.model_key), null);
  assert.equal(await s.db.prepare("SELECT id FROM submissions WHERE id=?").bind(row.id).first(), null);
});
test("upload tickets are scoped and incomplete or oversized uploads cannot be submitted", async (t) => {
  const s = await setup(t),
    p = await init(s);
  assert.equal(p.response.status, 200);
  assert.equal(
    (await s.request(`/uploads/${p.body.id}/model`, { method: "PUT", headers: { "Content-Length": "3" }, body: "bad" }))
      .status,
    401,
  );
  assert.equal((await sendPart(s, p.body, "model", Buffer.from("bad"))).status, 400);
  assert.equal(
    (
      await s.request(`/uploads/${p.body.id}/complete`, {
        method: "POST",
        headers: { Authorization: "Bearer " + p.body.token },
      })
    ).status,
    409,
  );
  const invalid = await init(s, { bytes: MAX_BYTES + 1 });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.error, /50 MB/);
});
test("R2 streams an actual 50 MB original and stores exactly the declared bytes", async (t) => {
  const s = await setup(t);
  const p = await init(s, { name: "large.step", bytes: MAX_BYTES });
  assert.equal(p.response.status, 200);
  const response = await sendPart(s, p.body, "model", Buffer.alloc(MAX_BYTES, 32));
  assert.equal(response.status, 200, await response.text());
  const row = await s.db.prepare("SELECT model_key,model_done FROM submissions WHERE id=?").bind(p.body.id).first();
  assert.equal(row.model_done, 1);
  assert.equal((await s.bucket.head(row.model_key)).size, MAX_BYTES);
});
test("atomic storage reservations stop uploads at the cap, including concurrent requests", async (t) => {
  const s = await setup(t);
  const initial = await submit(s);
  await s.db
    .prepare("UPDATE submissions SET reserved_bytes=? WHERE id=?")
    .bind(STORAGE_LIMIT - 600000, initial.body.id)
    .run();
  const results = await Promise.all([init(s), init(s)]);
  assert.deepEqual(results.map((x) => x.response.status).sort(), [200, 507]);
  const usage = await s.db.prepare("SELECT SUM(reserved_bytes) AS used FROM submissions").first();
  assert(usage.used <= STORAGE_LIMIT);
});
test("View at home matches school and first name, exposes no staff/notes and scopes model access", async (t) => {
  const s = await setup(t),
    own = await submit(s),
    other = await submit(s, { details: { ...details(), firstName: "Sam" } });
  const lookup = await s.request("/student/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId: details().schoolId, firstName: "  mIA  " }),
  });
  assert.equal(lookup.status, 200);
  const result = await lookup.json();
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].id, own.body.id);
  for (const field of ["notes", "staff", "classroom", "colourLabel", "filename", "designLink"])
    assert.equal(result.files[0][field], undefined);
  assert(!JSON.stringify(result).includes("Please keep the base flat"));
  assert.equal(
    (await s.request(`/student/files/${own.body.id}/model`, { headers: { Authorization: "Bearer " + result.token } }))
      .status,
    200,
  );
  assert.equal(
    (await s.request(`/student/files/${other.body.id}/model`, { headers: { Authorization: "Bearer " + result.token } }))
      .status,
    404,
  );
  assert.equal((await s.request(`/student/files/${own.body.id}/model`)).status, 401);
  await s.db
    .prepare("UPDATE submissions SET expires_at=? WHERE id=?")
    .bind(Date.now() - 1, own.body.id)
    .run();
  const gone = await s.request(`/student/files/${own.body.id}/model`, {
    headers: { Authorization: "Bearer " + result.token },
  });
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).error, "This has been deleted.");
});
test("scheduled cleanup removes expired and unfinished files, metadata and reservations, preserving other content", async (t) => {
  const s = await setup(t),
    expired = await submit(s),
    pending = await init(s),
    fresh = await submit(s);
  assert.equal((await sendPart(s, pending.body, "model", pending.model)).status, 200);
  await s.db
    .prepare("UPDATE submissions SET expires_at=? WHERE id=?")
    .bind(Date.now() - 1000, expired.body.id)
    .run();
  await s.db
    .prepare("UPDATE submissions SET pending_until=? WHERE id=?")
    .bind(Date.now() - 1000, pending.body.id)
    .run();
  await s.bucket.put("staff/unrelated.txt", "Keep");
  const worker = await s.mf.getWorker();
  await worker.scheduled({ cron: "*/10 * * * *" });
  const remaining = await s.db.prepare("SELECT id FROM submissions").all();
  assert.deepEqual(
    remaining.results.map((r) => r.id),
    [fresh.body.id],
  );
  assert(await s.bucket.head("staff/unrelated.txt"));
  assert.equal((await s.bucket.list({ prefix: "submissions/" })).objects.length, 2);
  const meta = await s.db.prepare("SELECT value FROM app_meta WHERE key='cleanup_last_success'").first();
  assert(meta);
});
test("signed sessions are revoked on logout and login attempts are limited", async (t) => {
  const s = await setup(t);
  const logout = await s.request("/admin/logout", { method: "POST", headers: s.headers });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await s.request("/admin/session", { headers: s.headers })).status, 401);
  let response;
  for (let i = 0; i < 8; i++)
    response = await s.request("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "incorrect-password" }),
    });
  assert.equal(response.status, 429);
});

test("home lookup retains schools with unexpired files after staff remove upload options", async (t) => {
  const s = await setup(t);
  await submit(s);
  await s.db
    .prepare("UPDATE app_meta SET value=? WHERE key='settings'")
    .bind(JSON.stringify({ ...s.settings, schools: [], classes: [] }))
    .run();
  const config = await s.request("/config").then((r) => r.json());
  assert.equal(config.acceptingUploads, false);
  assert.deepEqual(config.schools, []);
  assert.deepEqual(config.lookupSchools, [{ id: details().schoolId, name: "School A" }]);
  const lookup = await s.request("/student/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId: details().schoolId, firstName: "Mia" }),
  });
  assert.equal((await lookup.json()).files.length, 1);
});
test("home lookup paginates matching files without losing older submissions", async (t) => {
  const s = await setup(t),
    first = await submit(s);
  const row = await s.db.prepare("SELECT * FROM submissions WHERE id=?").bind(first.body.id).first();
  await s.db.batch(
    Array.from({ length: 30 }, (_, i) => {
      const id = crypto.randomUUID(),
        requestId = crypto.randomUUID();
      return s.db
        .prepare(
          `INSERT INTO submissions(id,request_id,school_id,lookup_name,data,state,reserved_bytes,model_bytes,preview_bytes,model_key,preview_key,model_done,preview_done,created_at,expires_at,pending_until) VALUES (?,?,?,?,?,'ready',?,?,?,?,?,1,1,?,?,?)`,
        )
        .bind(
          id,
          requestId,
          row.school_id,
          row.lookup_name,
          JSON.stringify({ ...JSON.parse(row.data), id, requestId }),
          row.reserved_bytes,
          row.model_bytes,
          row.preview_bytes,
          row.model_key,
          row.preview_key,
          row.created_at - i - 1,
          row.expires_at,
          row.pending_until,
        );
    }),
  );
  const get = (offset) =>
    s
      .request("/student/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId: details().schoolId, firstName: "Mia", offset }),
      })
      .then((r) => r.json());
  const page1 = await get(0),
    page2 = await get(page1.nextOffset);
  assert.equal(page1.files.length, 30);
  assert.equal(page1.nextOffset, 30);
  assert.equal(page2.files.length, 1);
  assert.equal(page2.nextOffset, null);
  assert.equal(new Set([...page1.files, ...page2.files].map((f) => f.id)).size, 31);
});
test("teachers set class codes; student config hides codes and submission resolves them server-side", async (t) => {
  const s = await setup(t),
    id = crypto.randomUUID();
  const settings = { ...s.settings, classes: [{ id, name: "Year 9", schoolId: details().schoolId, code: "Print-9!" }] };
  assert.equal(
    (await s.request("/admin/settings", { method: "PUT", headers: s.headers, body: JSON.stringify(settings) })).status,
    200,
  );
  const config = await s.request("/config").then((r) => r.json());
  assert(!JSON.stringify(config).includes("Print-9!"));
  assert.equal(
    (
      await s
        .request("/classes/resolve", {
          method: "POST",
          body: JSON.stringify({ schoolId: details().schoolId, classCode: " print-9! " }),
        })
        .then((r) => r.json())
    ).classId,
    id,
  );
  assert.equal(
    (
      await s.request("/classes/resolve", {
        method: "POST",
        body: JSON.stringify({ schoolId: crypto.randomUUID(), classCode: "Print-9!" }),
      })
    ).status,
    400,
  );
  const joined = await submit(s, {
    details: {
      ...details(),
      classCode: "PRINT-9!",
      classId: crypto.randomUUID(),
      scalePercent: 150,
      dimensionsMm: [30, 30, 30],
    },
  });
  const row = await s.db.prepare("SELECT data FROM submissions WHERE id=?").bind(joined.body.id).first(),
    record = JSON.parse(row.data);
  assert.equal(record.classId, id);
  assert.equal(record.scalePercent, 150);
  assert.deepEqual(record.dimensionsMm, [30, 30, 30]);
  assert.match(record.filename, /^School-A_BLUE_\d{4}-\d\d-\d\d_Mia\.stl$/);
});
test("bulk status changes update selected ready files and skip expired files", async (t) => {
  const s = await setup(t),
    one = await submit(s),
    two = await submit(s);
  await s.db
    .prepare("UPDATE submissions SET expires_at=? WHERE id=?")
    .bind(Date.now() - 1, two.body.id)
    .run();
  const response = await s.request("/admin/submissions/bulk-status", {
    method: "POST",
    headers: s.headers,
    body: JSON.stringify({ ids: [one.body.id, two.body.id], status: "printing" }),
  });
  assert.deepEqual(await response.json(), { updated: 1, skipped: 1 });
  const row = await s.db.prepare("SELECT data FROM submissions WHERE id=?").bind(one.body.id).first();
  assert.equal(JSON.parse(row.data).status, "printing");
  assert.equal((await s.request("/admin/submissions/bulk-status", { method: "POST", body: "{}" })).status, 401);
});
test("raw ZIP uploads are rejected rather than stored", async (t) => {
  const s = await setup(t),
    result = await init(s, { name: "models.zip" });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /extracted/);
  assert.equal((await s.bucket.list()).objects.length, 0);
});

// Security --------------------------------------------------------------------------

const from = (ip) => ({ "CF-Connecting-IP": ip });
const json = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://studio.test", ...headers },
  body: JSON.stringify(body),
});
async function activity(s) {
  const response = await s.request("/admin/settings", { headers: s.headers });
  return (await response.json()).security.activity.map((row) => row.event);
}

test("networks group IPv6 by /64 and treat IPv4-mapped addresses as IPv4", () => {
  assert.equal(networkOf("2001:db8:1:2:aaaa::1"), networkOf("2001:0db8:0001:0002:ffff:1:2:3"));
  assert.notEqual(networkOf("2001:db8:1:2::1"), networkOf("2001:db8:1:3::1"));
  assert.equal(networkOf("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(networkOf("203.0.113.9"), "203.0.113.9");
});

test("responses send hardened headers and staff get a __Host- session cookie", async (t) => {
  const s = await setup(t, { signIn: false });
  const response = await s.request("/config");
  assert.match(response.headers.get("strict-transport-security"), /max-age=31536000/);
  assert.match(response.headers.get("permissions-policy"), /camera=\(\)/);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  const login = await s.request("/admin/login", json({ password: PASSWORD }));
  assert.match(login.headers.get("set-cookie"), /^__Host-bnts_teacher=[^;]+; Path=\/; HttpOnly; SameSite=Lax;.*Secure/);
});

test("only failed sign-ins count, a network is locked after five, and attempts are logged", async (t) => {
  const s = await setup(t);
  const attempt = (password, ip) => s.request("/admin/login", json({ password }, from(ip)));
  for (let i = 0; i < 3; i++) assert.equal((await attempt(PASSWORD, "198.51.100.7")).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await attempt("wrong-password", "198.51.100.7")).status, 401);
  const locked = await attempt(PASSWORD, "198.51.100.7");
  assert.equal(locked.status, 429);
  assert.match((await locked.json()).error, /Wait 15 minutes/);
  assert.equal((await attempt(PASSWORD, "203.0.113.20")).status, 200, "other networks are unaffected");
  const events = await activity(s);
  assert.equal(events.filter((e) => e === "sign_in_failed").length, 5);
  assert.ok(events.includes("sign_in"));
});

test("wrong passwords count for exactly the last 15 minutes, with no boundary to straddle", async (t) => {
  const s = await setup(t);
  const attempt = (password) => s.request("/admin/login", json({ password }, from("198.51.100.8")));
  for (let i = 0; i < 5; i++) assert.equal((await attempt("wrong-password")).status, 401);
  // Make those failures look older by moving their one-minute buckets back in time.
  const age = async (minutes) => {
    const { results } = await s.db.prepare("SELECT key FROM rate_limits WHERE key LIKE 'login-fail:%'").all();
    for (const { key } of results)
      await s.db
        .prepare("UPDATE rate_limits SET key=? WHERE key=?")
        .bind(key.replace(/:m\d+$/, ":m" + (Math.floor(Date.now() / 60000) - minutes)), key)
        .run();
  };
  await age(14);
  assert.equal((await attempt(PASSWORD)).status, 429, "14 minutes ago still counts");
  await age(16);
  assert.equal((await attempt(PASSWORD)).status, 200, "16 minutes ago no longer counts");
});

test("sign out everywhere ends every existing staff session", async (t) => {
  const s = await setup(t);
  const second = await s.request("/admin/login", json({ password: PASSWORD }));
  const otherCookie = second.headers.get("set-cookie").split(";")[0];
  const response = await s.request("/admin/sign-out-everywhere", { method: "POST", headers: s.headers });
  assert.equal(response.status, 200);
  assert.equal((await s.request("/admin/session", { headers: s.headers })).status, 401);
  assert.equal((await s.request("/admin/session", { headers: { Cookie: otherCookie } })).status, 401);
  const fresh = await s.request("/admin/login", json({ password: PASSWORD }));
  const cookie = fresh.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await s.request("/admin/session", { headers: { Cookie: cookie } })).status,
    200,
    "signing in again works",
  );
});

test("pausing uploads stops new uploads straight away and resuming allows them", async (t) => {
  const s = await setup(t);
  const pause = await s.request("/admin/uploads", { method: "POST", headers: s.headers, body: '{"paused":true}' });
  assert.equal(pause.status, 200);
  const config = await (await s.request("/config")).json();
  assert.equal(config.uploadsPaused, true);
  assert.equal(config.acceptingUploads, false);
  const blocked = await init(s);
  assert.equal(blocked.response.status, 503);
  assert.match(blocked.body.error, /paused/);
  await s.request("/admin/uploads", { method: "POST", headers: s.headers, body: '{"paused":false}' });
  assert.equal((await init(s)).response.status, 200);
  assert.ok((await activity(s)).includes("uploads_paused"));
});

test("a required class code blocks uploads without a valid code", async (t) => {
  const s = await setup(t);
  const saved = await s.request("/admin/settings", {
    method: "PUT",
    headers: s.headers,
    body: JSON.stringify({
      ...s.settings,
      requireClassCode: true,
      classes: [{ id: crypto.randomUUID(), name: "Design", schoolId: details().schoolId, code: "PRINT4" }],
    }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await (await s.request("/config")).json()).requireClassCode, true);
  assert.equal(
    (await s.request("/classes/resolve", json({ schoolId: details().schoolId, classCode: "" }))).status,
    400,
  );
  const missing = await init(s);
  assert.equal(missing.response.status, 400);
  assert.match(missing.body.error, /class code/);
  assert.equal((await init(s, { details: { ...details(), classCode: "print4" } })).response.status, 200);
});

test("one network can't reserve more than 4 GB of unfinished uploads; other networks are unaffected", async (t) => {
  const s = await setup(t);
  const big = { bytes: MAX_BYTES };
  let accepted = 0,
    blocked;
  // Claiming 50 MB uploads without ever sending them is how storage would be hoarded.
  for (let i = 0; i < 100 && !blocked; i++) {
    const attempt = await init(s, big, from("198.51.100.50"));
    if (attempt.response.status === 200) accepted++;
    else blocked = attempt;
  }
  assert.equal(blocked?.response.status, 429);
  assert.match(blocked.body.error, /in progress/);
  assert.equal(accepted, Math.floor(4000e6 / (MAX_BYTES + 512 * 1024 + 16 * 1024)));
  assert.equal((await init(s, big, from("203.0.113.60"))).response.status, 200);
});

test("the site-wide daily data budget stops a flood, but resuming an existing upload still works", async (t) => {
  const s = await setup(t);
  const first = await init(s);
  assert.equal(first.response.status, 200);
  const window = Math.floor(Date.now() / 1000 / 86400);
  await s.db
    .prepare("UPDATE rate_limits SET count=? WHERE key=?")
    .bind(6000, "upload-mb:global:" + window)
    .run();
  const blocked = await init(s);
  assert.equal(blocked.response.status, 429);
  assert.match(blocked.body.error, /very busy/);
  const retry = await s.request(
    "/uploads/init",
    json({ details: first.data, name: "cube.stl", bytes: first.model.length, previewBytes: png.length }),
  );
  assert.equal(retry.status, 200, "resuming the same request is not counted again");
});

test("teachers can delete many requests at once, including their stored files", async (t) => {
  const s = await setup(t);
  const a = await submit(s),
    b = await submit(s);
  const response = await s.request("/admin/submissions/bulk-delete", {
    method: "POST",
    headers: s.headers,
    body: JSON.stringify({ ids: [a.receipt.id, b.receipt.id] }),
  });
  assert.deepEqual(await response.json(), { deleted: 2, skipped: 0 });
  assert.equal((await s.bucket.list()).objects.length, 0);
  assert.equal((await (await s.request("/admin/submissions", { headers: s.headers })).json()).records.length, 0);
  assert.ok((await activity(s)).includes("deleted"));
});

// A Cloudflare Access team with a real RSA signing key, served from a mocked certs endpoint.
async function accessTeam() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-key", alg: "RS256" };
  const team = "bnts.cloudflareaccess.com",
    aud = "test-audience-tag";
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = async (claims = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const body = `${encode({ alg: "RS256", kid: "test-key" })}.${encode({
      aud: [aud],
      iss: `https://${team}`,
      email: "teacher@bnts.vic.edu.au",
      iat: now,
      exp: now + 3600,
      ...claims,
    })}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body));
    return body + "." + Buffer.from(signature).toString("base64url");
  };
  const outbound = (request) =>
    request.url === `https://${team}/cdn-cgi/access/certs`
      ? Response.json({ keys: [jwk] })
      : new Response("Not found", { status: 404 });
  return { team, aud, token, outbound };
}

test("with Cloudflare Access set up, staff pages need a valid Access token and record who signed in", async (t) => {
  const access = await accessTeam();
  const s = await setup(t, {
    bindings: { ACCESS_TEAM_DOMAIN: access.team, ACCESS_AUD: access.aud },
    outbound: access.outbound,
    staffHeaders: { "Cf-Access-Jwt-Assertion": await access.token() },
  });
  assert.equal((await s.request("/config")).status, 200, "students are unaffected");
  const tryLogin = (headers = {}) => s.request("/admin/login", json({ password: PASSWORD }, headers));
  assert.equal((await tryLogin()).status, 403, "no token");
  assert.equal((await tryLogin({ "Cf-Access-Jwt-Assertion": await access.token({ aud: ["other"] }) })).status, 403);
  const expired = await access.token({ exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal((await tryLogin({ "Cf-Access-Jwt-Assertion": expired })).status, 403, "expired token");
  const [head, , signature] = (await access.token()).split(".");
  const forged = [
    head,
    Buffer.from(JSON.stringify({ aud: [access.aud], iss: `https://${access.team}`, exp: 9e9 })).toString("base64url"),
    signature,
  ].join(".");
  assert.equal((await tryLogin({ "Cf-Access-Jwt-Assertion": forged })).status, 403, "tampered token");
  assert.equal((await s.mf.dispatchFetch("https://studio.test/teacher")).status, 403, "the staff page itself");
  const settings = await (await s.request("/admin/settings", { headers: s.headers })).json();
  assert.equal(settings.security.accessEnabled, true);
  assert.equal(settings.security.accessEmail, "teacher@bnts.vic.edu.au");
  assert.ok(
    settings.security.activity.some((row) => row.event === "sign_in" && row.detail === "teacher@bnts.vic.edu.au"),
  );
});

test("with Turnstile set up, new uploads need a passed robot check", async (t) => {
  let verified = 0;
  const outbound = async (request) => {
    if (request.url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify")
      return new Response("Not found", { status: 404 });
    const form = await request.formData();
    verified++;
    return Response.json({
      success: form.get("secret") === "test-secret" && form.get("response") === "pass",
      hostname: "studio.test",
    });
  };
  const s = await setup(t, {
    bindings: { TURNSTILE_SITE_KEY: "test-site-key", TURNSTILE_SECRET_KEY: "test-secret" },
    outbound,
  });
  assert.equal((await (await s.request("/config")).json()).turnstileSiteKey, "test-site-key");
  const withoutCheck = await init(s);
  assert.equal(withoutCheck.response.status, 403);
  assert.match(withoutCheck.body.error, /robot check/);
  assert.equal((await s.request("/uploads/human", json({ token: "fail" }))).status, 403);
  const pass = await s.request("/uploads/human", json({ token: "pass" }));
  assert.equal(pass.status, 200);
  const { token } = await pass.json();
  for (let i = 0; i < 3; i++) assert.equal((await init(s, {}, { "X-Human-Token": token })).response.status, 200);
  assert.equal(verified, 2, "one passed check covers a batch of files");
  const elsewhere = await init(s, {}, { "X-Human-Token": token, "CF-Connecting-IP": "203.0.113.99" });
  assert.equal(elsewhere.response.status, 403, "a pass can't be reused from another network");
});

// Capacity ------------------------------------------------------------------------
// A school sends a whole year level through one internet address, so 100 students
// uploading and checking their files at once must all succeed.

const nameFor = (i) => "Student " + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
async function sendAs(s, firstName, network) {
  const p = await init(s, { details: { ...details(), firstName } }, network);
  if (p.response.status !== 200) return { status: p.response.status, error: p.body.error };
  for (const [kind, data] of [
    ["model", p.model],
    ["preview", png],
  ]) {
    const response = await sendPart(s, p.body, kind, data);
    if (response.status !== 200) return { status: response.status, error: (await response.json()).error };
  }
  const done = await s.request(`/uploads/${p.body.id}/complete`, {
    method: "POST",
    headers: { Authorization: "Bearer " + p.body.token, Origin: "https://studio.test" },
  });
  return { status: done.status, error: done.status === 201 ? "" : (await done.json()).error };
}

test("100 students on one school network can upload at the same time, then all check their files", async (t) => {
  const s = await setup(t);
  const school = from("203.0.113.10");
  const started = Date.now();
  // Everyone starts together. A quarter send a ZIP of three files, which the page sends one after another.
  const results = await Promise.all(
    Array.from({ length: 100 }, async (_, i) => {
      const outcomes = [];
      for (let file = 0; file < (i % 4 === 0 ? 3 : 1); file++) outcomes.push(await sendAs(s, nameFor(i), school));
      return outcomes;
    }),
  );
  const failures = results.flat().filter((r) => r.status !== 201);
  assert.deepEqual(failures, [], "every upload succeeds");
  assert.equal(results.flat().length, 150);
  const queue = await (await s.request("/admin/submissions", { headers: s.headers })).json();
  assert.equal(queue.records.length, 150, "the teacher sees every file");
  t.diagnostic(`150 uploads from 100 students on one network: ${Date.now() - started} ms in the local Workers runtime`);
  // The same class then opens "Find your uploads" at once.
  const lookups = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      s.request("/student/lookup", json({ schoolId: details().schoolId, firstName: nameFor(i) }, school)),
    ),
  );
  assert.deepEqual(
    lookups.map((r) => r.status).filter((status) => status !== 200),
    [],
    "every lookup succeeds",
  );
});
