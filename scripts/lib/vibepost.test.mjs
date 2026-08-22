import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendToVibePost } from "./vibepost.mjs";

test("VibePost delivery uses narrow ingest contract, not service_role auth", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibepost-ingest-test-"));
  const filePath = path.join(dir, "clip.mp4");
  fs.writeFileSync(filePath, Buffer.from([0, 1, 2, 3]));
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ id: "video-1", video_url: "https://example.test/video" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await sendToVibePost({
      ingestUrl: "https://rjtyjybwygfkdekdzqbm.supabase.co/functions/v1/ingest-video",
      secret: "narrow-secret",
      filePath,
      name: "clip",
      caption: "caption",
      prompt: "prompt",
      source: "content-brigade-v2",
    });
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(captured.init.headers["X-Ingest-Secret"], "narrow-secret");
  assert.equal(captured.init.headers.Authorization, undefined);
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.ok(captured.init.body.get("file") instanceof Blob);
  assert.equal(captured.init.body.get("video"), null);
  assert.equal(captured.init.body.get("prompt"), "prompt");
  assert.equal(captured.init.body.get("source"), "content-brigade-v2");
  assert.match(String(captured.init.body.get("delivery_id")), /^[a-f0-9]{64}$/);
});

test("VibePost delivery refuses to send the ingest secret to another host", async () => {
  await assert.rejects(() => sendToVibePost({
    ingestUrl: "https://attacker.example/functions/v1/ingest-video",
    secret: "narrow-secret",
    filePath: "does-not-need-to-exist.mp4",
    name: "clip",
  }), /configured VibePost HTTPS ingest endpoint/);
});
