import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Kito Video Studio editor shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Kito Video Studio/);
  assert.match(html, /Render cục bộ/);
  assert.match(html, /Hiệu ứng/);
  assert.match(html, /Timeline/);
  assert.match(html, /Khôi phục/);
  assert.match(html, /Hoàn tác/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps editor safety and render checks in the source", async () => {
  const [page, css, notes] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../PROJECT-NOTES.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /beforeunload/);
  assert.match(page, /restoreLastSavedProject/);
  assert.match(page, /historyPast/);
  assert.match(page, /startTimelineEdgeDrag/);
  assert.match(page, /runRenderPreflight/);
  assert.match(page, /indexedDB/);
  assert.match(page, /timelineProgress/);
  assert.match(page, /timeline-playhead-layer/);
  assert.match(page, /event\.key === " "/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /timeline-edge-handle/);
  assert.match(css, /timeline-playhead-layer/);
  assert.match(css, /preflight-card/);
  assert.match(notes, /không tự động ghi/);
  assert.match(notes, /Ctrl\/Cmd \+ Z/);
});
