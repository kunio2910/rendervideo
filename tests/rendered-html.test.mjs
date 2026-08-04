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
  assert.match(page, /startTimelineScrub/);
  assert.match(page, /startTimelinePopupDrag/);
  assert.match(page, /popupStart/);
  assert.match(page, /zoomStart/);
  assert.match(page, /renderDuration = Math\.max\(projectDuration, totalDuration\)/);
  assert.match(page, /DEFAULT_MARKER_EFFECT_SETTINGS/);
  assert.match(page, /zoomMarkerEnabled: true/);
  assert.match(page, /getMarkerEffectSettings\(item\)/);
  assert.match(page, /zoomMarkerCenterX/);
  assert.match(page, /startMapPointDrag\(event, "camera"\)/);
  assert.match(page, /startMapPointDrag\(event, "marker"\)/);
  assert.match(css, /phone-preview\.is-playing > \.zoom-camera-target/);
  assert.match(css, /phone-preview > \.zoom-center-marker[\s\S]*z-index: 8[\s\S]*pointer-events: auto/);
  assert.doesNotMatch(css, /phone-preview:not\(\.map-focused\)[^{]*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(css, /--marker-offset-x/);
  assert.match(page, /event\.key === " "/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /timeline-edge-handle/);
  assert.match(css, /timeline-playhead-layer/);
  assert.match(css, /playhead-grabber/);
  assert.match(css, /preflight-card/);
  assert.match(notes, /không tự động ghi/);
  assert.match(notes, /Ctrl\/Cmd \+ Z/);
});

test("keeps preview and FFmpeg render settings aligned", async () => {
  const [page, css, renderer, localServer] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/render-video.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local-render-server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /assetPreviewUrls/);
  assert.match(page, /imageVisible: imageEnabled/);
  assert.match(page, /fps: renderFps/);
  assert.match(page, /transitionDuration: playing \? "0ms"/);
  assert.match(css, /transform-origin: center bottom/);
  assert.match(css, /phone-preview\.is-playing \.popup-resize-handle/);
  assert.match(renderer, /PREVIEW_REFERENCE_WIDTH = 472/);
  assert.match(renderer, /scene\.zoomMarkerCenterX/);
  assert.match(renderer, /main_w\*\$\{markerCenterX\}/);
  assert.match(renderer, /timelineDuration = Math\.max/);
  assert.match(renderer, /aresample=async=1:first_pts=0/);
  assert.match(renderer, /aformat=sample_rates=48000:channel_layouts=stereo,volume=0\.95,apad/);
  assert.match(renderer, /"-c:v", "copy"/);
  assert.match(renderer, /"-c:a", "aac"/);
  assert.doesNotMatch(renderer, /adelay=/);
  assert.doesNotMatch(renderer, /fallback-\$\{index \+ 1\}/);
  assert.match(localServer, /--use-system-ca/);
});
