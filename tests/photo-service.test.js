import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadMoment } from "../photo-service.js";
const photo = {
  blob: new Blob(["test"], { type: "image/webp" }),
  title: " Moment ",
  pos: [48, 10],
  taken: "2026-10-08T12:00:00Z",
};
function mock({
  signedIn = true,
  uploadError = null,
  rpcError = null,
  transport = false,
  cleanupError = null,
} = {}) {
  const events = [];
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: signedIn ? { id: "owner" } : null },
      }),
    },
    storage: {
      from: () => ({
        upload: async (key) => {
          events.push(["upload", key]);
          return { error: uploadError };
        },
        remove: async (keys) => {
          events.push(["remove", keys]);
          return { error: cleanupError };
        },
      }),
    },
    rpc: (name, args) => ({
      single: async () => {
        events.push(["rpc", name, args]);
        if (transport) throw Error("network");
        return { data: { id: "photo" }, error: rpcError };
      },
    }),
  };
  return { client, events };
}
test("login required before storage access", async () => {
  const { client, events } = mock({ signedIn: false });
  await assert.rejects(uploadMoment(client, photo), /anmelden/);
  assert.equal(events.length, 0);
});
test("invalid metadata rejected before upload", async () => {
  const { client, events } = mock();
  await assert.rejects(
    uploadMoment(client, { ...photo, pos: [NaN, 10] }),
    /gültigen/,
  );
  assert.equal(events.length, 0);
});
test("storage rejection never inserts metadata", async () => {
  const { client, events } = mock({ uploadError: Error("limit") });
  await assert.rejects(uploadMoment(client, photo), /limit/);
  assert.deepEqual(
    events.map((e) => e[0]),
    ["upload"],
  );
});
test("successful upload registers matching key and normalized title", async () => {
  const { client, events } = mock();
  assert.deepEqual(await uploadMoment(client, photo), { id: "photo" });
  assert.equal(events[1][2].photo_key, events[0][1]);
  assert.equal(events[1][2].photo_title, "Moment");
});
test("confirmed SQL rejection removes unregistered file", async () => {
  const { client, events } = mock({
    rpcError: { code: "42501", message: "denied" },
  });
  await assert.rejects(uploadMoment(client, photo), /denied/);
  assert.deepEqual(
    events.map((e) => e[0]),
    ["upload", "rpc", "remove"],
  );
  assert.equal(events[2][1][0], events[0][1]);
});
test("uncertain network outcome keeps possibly committed file", async () => {
  for (const options of [
    { transport: true },
    { rpcError: { message: "Failed to fetch", code: "" } },
  ]) {
    const { client, events } = mock(options);
    await assert.rejects(uploadMoment(client, photo), /nicht bestätigt/);
    assert.deepEqual(
      events.map((e) => e[0]),
      ["upload", "rpc"],
    );
  }
});
test("failed cleanup is reported", async () => {
  const { client } = mock({
    rpcError: { code: "22023", message: "bad" },
    cleanupError: Error("network"),
  });
  await assert.rejects(uploadMoment(client, photo), /nicht aufgeräumt/);
});
