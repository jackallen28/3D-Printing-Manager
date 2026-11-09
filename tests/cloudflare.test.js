import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { details, stl, png } from "./fixtures.js";
import { DEFAULT_SETTINGS, BAMBU_COLOURS, MAX_BYTES } from "../shared/catalog.js";
import { STORAGE_LIMIT } from "../cloudflare/storage.js";
import { initialiseDatabase } from "../cloudflare/schema.js";
const PASSWORD = "cloudflare-test-teacher-password";
async function setup(t) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: ".cloudflare-build/worker.js",
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["PRINTS"],
    bindings: { TEACHER_PASSWORD: PASSWORD },
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
  const login = await request("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://studio.test" },
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
  };
  return { mf, db, bucket, request, headers, settings };
}
async function init(s, overrides = {}) {
  const data = details(),
    model = stl();
  const response = await s.request("/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://studio.test" },
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
