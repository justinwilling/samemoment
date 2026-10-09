import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const origin = "https://samemoment.example";
function request(fields = {}, token = true) {
  const form = new FormData();
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  form.set("file", new Blob([bytes], { type: "image/webp" }), "photo.webp");
  for (const [key, value] of Object.entries({
    title: "Moment",
    lat: "48",
    lng: "10",
    taken_at: "2026-10-08T12:00:00Z",
    ...fields,
  })) {
    if (value !== null) form.set(key, value);
  }
  return new Request(origin + "/upload", {
    method: "POST",
    headers: {
      Origin: origin,
      ...(token ? { Authorization: "Bearer test" } : {}),
    },
    body: form,
  });
}
function env() {
  const events = [];
  return {
    events,
    ALLOWED_ORIGIN: origin,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    PHOTOS: {
      put: async () => events.push("put"),
      delete: async () => events.push("delete"),
    },
  };
}
test("untrusted origin is rejected", async () => {
  const result = await worker.fetch(
    new Request(origin + "/upload", {
      method: "POST",
      headers: { Origin: "https://other.example" },
    }),
    env(),
  );
  assert.equal(result.status, 403);
});
test("missing session cannot upload", async () => {
  const config = env();
  assert.equal((await worker.fetch(request({}, false), config)).status, 401);
  assert.deepEqual(config.events, []);
});
test("metadata, cleanup and successful response", async (t) => {
  const original = globalThis.fetch;
  try {
    for (const value of [null, "", "NaN", "91"]) {
      globalThis.fetch = async () => Response.json({ id: "user" });
      const config = env();
      assert.equal(
        (await worker.fetch(request({ lat: value }), config)).status,
        400,
      );
      assert.deepEqual(config.events, []);
    }
    for (const failure of ["http", "network"]) {
      let count = 0;
      globalThis.fetch = async () => {
        if (++count === 1) return Response.json({ id: "user" });
        if (failure === "network") throw new Error("network");
        return Response.json({}, { status: 500 });
      };
      const config = env();
      assert.equal((await worker.fetch(request(), config)).status, 500);
      assert.deepEqual(config.events, ["put", "delete"]);
    }
    let count = 0;
    globalThis.fetch = async (_url, options) =>
      ++count === 1
        ? Response.json({ id: "user" })
        : Response.json([{ id: "photo", ...JSON.parse(options.body) }]);
    const config = env();
    const response = await worker.fetch(request(), config);
    assert.equal(response.status, 201);
    const { photo } = await response.json();
    assert.equal(photo.title, "Moment");
    assert.equal(photo.owner_id, undefined);
    assert.equal(photo.image_key, undefined);
    assert.deepEqual(config.events, ["put"]);
  } finally {
    globalThis.fetch = original;
  }
});
