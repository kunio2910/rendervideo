import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { cacheRemoteResource, collectProjectRemoteResources } from "../scripts/render-resource-cache.mjs";
import { processSpriteSheetBuffer } from "../scripts/sprite-sheet.mjs";

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
  assert.doesNotMatch(html, /history-button|restore-button/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("preloads remote image, video, and audio once into the persistent renderer cache", async (t) => {
  const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "kito-render-cache-"));
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": "4" });
    response.end("test");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/shared.mp3`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(cacheRoot, { recursive: true, force: true });
  });

  const first = await cacheRemoteResource({ cacheRoot, kind: "audio", value: url, fallbackName: "track.mp3" });
  const second = await cacheRemoteResource({ cacheRoot, kind: "audio", value: url, fallbackName: "track.mp3" });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(requestCount, 1);

  const resources = collectProjectRemoteResources({
    background: "https://example.test/background.png",
    backgroundMusic: "https://example.test/music.mp3",
    scenes: [{
      sceneVisible: true,
      audioTracks: [{ visible: true, source: "https://example.test/voice.mp3" }],
      popups: [{ visible: true, imageVisible: true, image: "https://example.test/popup.jpg", video: "https://example.test/popup.mp4" }],
      mapDecorations: [{ visible: true, type: "animated-sticker", assetType: "webm", asset: "https://example.test/effect.webm" }],
      sceneImages: [{ visible: true, mediaType: "video", url: "https://example.test/scene.mp4" }],
    }],
  });
  assert.deepEqual(resources.map((item) => item.kind).sort(), ["audio", "audio", "image", "image", "video", "video", "video"]);
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
  assert.match(page, /runRenderPreflight/);
  assert.match(page, /indexedDB/);
  assert.match(page, /timelineProgress/);
  assert.match(page, /timeline-playhead-layer/);
  assert.match(page, /timelineEffectItems/);
  assert.match(page, /effect-clip/);
  assert.match(page, /startTimelineScrub/);
  assert.match(page, /startTimelinePopupDrag/);
  assert.match(page, /popupStart/);
  assert.match(page, /Bật hiệu ứng zoom bản đồ/);
  assert.match(page, /Thời gian kết thúc zoom/);
  assert.match(page, /Âm lượng nhạc nền/);
  assert.match(page, /Âm lượng âm thanh/);
  assert.match(page, /zoom-focus-target/);
  assert.match(page, /startMapPointDrag/);
  assert.match(page, /sceneVisible/);
  assert.match(page, /scene-visibility-button/);
  assert.match(page, /toggleSceneVisibility/);
  assert.match(page, /reflowVisibleSceneTimeline/);
  assert.match(page, /const displayItem/);
  assert.match(page, /visibleScenes\.filter/);
  assert.match(page, /visibleScenes\.map/);
  assert.match(page, /popupLayout/);
  assert.match(page, /popupTheme/);
  assert.match(page, /popupTextEffect/);
  assert.match(page, /const focusEditorLayer/);
  assert.match(page, /const selectPreviewLayer/);
  assert.match(page, /editor-layer-popup-/);
  assert.match(page, /editor-layer-text-/);
  assert.match(page, /editor-layer-images-/);
  assert.match(page, /previewAudioMuted/);
  assert.match(page, /togglePreviewAudio/);
  assert.match(page, /const \[previewPlaybackMode, setPreviewPlaybackMode\] = useState\(false\)/);
  assert.match(page, /sceneIsVisibleInPlayback = !previewPlaybackMode/);
  assert.match(page, /setPreviewPlaybackMode\(true\);/);
  assert.match(page, /playing \? "Tạm dừng" : previewPlaybackMode \? "Tiếp tục" : "Xem thử"/);
  assert.match(page, /preview-audio-toggle/);
  assert.match(page, /previewAudioMuted \|\|/);
  assert.match(page, /popupVideo/);
  assert.match(page, /typeof rawPopup\.transparentMedia === "boolean"/);
  assert.match(page, /typeof rawPopup\.popupTransparentMedia === "boolean"/);
  assert.match(page, /const updatePopupMedia = \(value: string, popupId = selectedPopupId\)/);
  assert.match(page, /copyEditorSection/);
  assert.match(page, /pasteEditorSection/);
  assert.match(page, /editorSectionActions/);
  assert.match(page, /type MapDecorationType/);
  assert.match(page, /mapDecorations/);
  assert.match(page, /addMapDecoration/);
  assert.match(page, /startMapDecorationDrag/);
  assert.match(page, /map-decoration-manager/);
  assert.match(page, /name: string/);
  assert.match(page, /beginSceneImageRename/);
  assert.match(page, /finishTextOverlayRename/);
  assert.match(page, /className="scene-image-action scene-image-edit"/);
  assert.match(page, /className="text-overlay-edit"/);
  assert.match(page, /className="map-decoration-edit"/);
  assert.match(page, /layer-name-input/);
  assert.match(css, /Compose layer lists need their labels to remain legible/);
  assert.match(css, /scene-image-select strong/);
  assert.match(page, /min="1" max="200" step="1" value=\{activeSceneImage\.width\}/);
  assert.match(page, /min="1" max="200" step="1" value=\{activeSceneImage\.height\}/);
  assert.match(page, /event\.currentTarget\.select\(\)/);
  assert.match(page, /isVideoMedia/);
  assert.match(page, /backgroundVideoPreviewSource/);
  assert.match(page, /background-media-preview/);
  assert.match(page, /startPopupDrag/);
  assert.match(page, /rulerEnabled/);
  assert.match(page, /type RulerStyle = "center" \| "grid" \| "all"/);
  assert.match(page, /rulerStyle/);
  assert.match(page, /normalizeRulerStyle/);
  assert.match(page, /toggleRuler/);
  assert.match(page, /preview-ruler-style-popover/);
  assert.match(page, /rulerPopoverPosition/);
  assert.match(page, /rulerPopoverRef/);
  assert.match(page, /REVIEW_ZOOM_MAX = 200/);
  assert.match(page, /readReviewZoomPreference/);
  assert.match(page, /snapDragPosition/);
  assert.match(page, /preview-ruler-toggle/);
  assert.match(page, /preview-alignment-guides/);
  assert.match(page, /previewFullscreen/);
  assert.match(page, /togglePreviewFullscreen/);
  assert.match(page, /preview-fullscreen-panel/);
  assert.match(page, /normalizeTimelineHeight/);
  assert.match(page, /timelineHeight/);
  assert.match(page, /setTimelineHeight\(normalizeTimelineHeight/);
  assert.match(page, /data-popup-id=\{popup\.id\}/);
  assert.match(page, /draggedPopupBounds/);
  assert.match(page, /height: `min\(\$\{popupGeometry\.height \|\| popup\.height \|\| 255\}px, 88%\)`/);
  assert.match(page, /popupX/);
  assert.match(page, /popupY/);
  assert.match(page, /zoomStart/);
  assert.match(page, /zoomEnd/);
  assert.match(page, /zoomInDuration/);
  assert.match(page, /zoomOutDuration/);
  assert.match(page, /centerX/);
  assert.match(page, /centerY/);
  assert.match(page, /SceneEffects/);
  assert.match(page, /normalizeSceneEffects/);
  assert.match(page, /updateSceneEffects/);
  assert.match(page, /snowEnabled/);
  assert.match(page, /lightFlickerEnabled/);
  assert.match(page, /rainEnabled/);
  assert.match(page, /thunderEnabled/);
  assert.match(page, /cloudEnabled/);
  assert.match(page, /scene-effect-layer/);
  assert.match(page, /rain-effect/);
  assert.match(page, /thunder-effect/);
  assert.match(page, /cloud-effect/);
  assert.match(page, /scene-visual-effects/);
  assert.match(page, /effects: \{ \.\.\.normalizeSceneEffects/);
  assert.match(page, /renderDuration = Math\.max\(projectDuration, totalDuration\)/);
  assert.match(page, /type AspectRatio = "9:16" \| "16:9"/);
  assert.match(page, /aspectRatio/);
  assert.match(page, /updateAspectRatio/);
  assert.match(page, /preview-landscape/);
  assert.match(page, /preview-control-panel/);
  assert.match(page, /preview-control-bar/);
  assert.match(page, /preview-panel-progress/);
  assert.match(page, /sceneLocalTime/);
  assert.match(page, /Tỷ lệ khung hình dự án/);
  assert.match(page, /selectAdjacentScene/);
  assert.match(page, /preview-navigation/);
  assert.match(page, /preview-zoom-control/);
  assert.match(page, /replayPlayback/);
  assert.match(page, /preview-replay-button/);
  assert.match(page, /type SubtitleCue/);
  assert.match(page, /id="editor-narration"/);
  assert.match(page, /value=\{scene\.narration\}/);
  assert.match(page, /value=\{activePopup\?\.narration \?\? ""\}/);
  assert.match(page, /narration: data\.narration/);
  assert.match(page, /type SubtitleStyle/);
  assert.match(page, /generateSubtitlesFromNarration/);
  assert.match(page, /Tạo từ lời thuyết minh/);
  assert.match(page, /subtitleStyle/);
  assert.match(page, /Chiều rộng khung chữ/);
  assert.match(page, /boxWidth/);
  assert.match(page, /borderFill/);
  assert.match(page, /subtitle-animation-/);
  assert.match(page, /typewriter/);
  assert.match(page, /subtitleEnabled/);
  assert.match(page, /activeSubtitle/);
  assert.match(page, /startSubtitleDrag/);
  assert.match(page, /deleteAllSubtitleCues/);
  assert.match(page, /Xóa tất cả/);
  assert.match(css, /\.subtitle-track/);
  assert.match(page, /editor-subtitle/);
  assert.match(page, /type StudioTab = "compose" \| "export" \| "settings"/);
  assert.match(page, /activeStudioTab === "settings"/);
  assert.match(page, /SettingsWorkspace/);
  assert.match(page, /duplicateProjectClip/);
  assert.match(page, /deleteProjectClip/);
  assert.match(page, /renameProjectClip/);
  assert.match(page, /onRenameClip/);
  assert.match(page, /editingClipId/);
  assert.match(page, /onDoubleClick/);
  assert.match(page, /onClick=\{\(\) => startClipRename\(selectedClip\)\}/);
  assert.match(page, /onKeyUp=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(page, /onBlur=\{commitClipRename\}/);
  assert.match(page, /selectedScene/);
  assert.match(page, /settings-full-scene-info/);
  assert.match(page, /saveLabel/);
  assert.match(page, /assetPreviewSource=\{assetPreviewSource\}/);
  assert.match(page, /projectFirstScene\?\.background/);
  assert.match(page, /sceneMediaValue/);
  assert.doesNotMatch(page, /settings-nav-title/);
  assert.doesNotMatch(page, /settings-page-heading/);
  assert.match(page, /settings-add-clip-action/);
  assert.match(page, /selectAdjacentScene/);
  assert.doesNotMatch(page, /preview-footer.*Background.*Popup/s);
  assert.match(page, /const updateScene[\s\S]{0,180}if \(!hydrated\) return;/);
  assert.doesNotMatch(page, /zoomMarkerEnabled|editor-camera/);
  assert.match(css, /zoom-focus-target/);
  assert.match(page, /event\.key === " "/);
  assert.match(page, /const moveSelectedMapLayer/);
  assert.match(page, /event\.shiftKey \? 5 : 1/);
  assert.match(page, /ArrowUp/);
  assert.match(page, /Dùng phím mũi tên để di chuyển/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /timeline-edge-handle/);
  assert.match(css, /timeline-playhead-layer/);
  assert.match(css, /overflow: clip/);
  assert.match(css, /playhead-grabber/);
  assert.match(css, /settings-layout/);
  assert.match(css, /settings-selected-scene/);
  assert.match(css, /settings-save-button/);
  assert.match(css, /settings-clip-thumb img/);
  assert.match(css, /settings-clip-title-input/);
  assert.match(css, /settings-info-grid/);
  assert.match(css, /subtitle-overlay/);
  assert.match(css, /subtitle-editor/);
  assert.match(css, /subtitle-clip/);
  assert.match(css, /subtitle-style-editor/);
  assert.match(css, /subtitle-align-steps/);
  assert.match(css, /subtitle-overlay\.is-dragging/);
  assert.match(css, /preview-ruler-toggle/);
  assert.match(css, /preview-ruler-style-popover/);
  assert.match(css, /preview-ruler-grid/);
  assert.match(css, /preview-alignment-guides/);
  assert.match(css, /preview-stage-layout/);
  assert.match(css, /preview-layer-panel/);
  assert.match(css, /preview-layer-item/);
  assert.match(css, /pointer-events: none !important/);
  assert.match(css, /preview-fullscreen::before/);
  assert.match(css, /preview-fullscreen-panel/);
  assert.match(css, /preview-fullscreen-panel \.phone-preview\.preview-portrait[\s\S]{0,180}width: min\(100%, 360px\) !important/);
  assert.match(css, /preview-fullscreen-panel \.phone-preview\.preview-landscape[\s\S]{0,180}height: auto !important/);
  assert.match(css, /data-theme="dark".*field > span/s);
  assert.match(css, /data-theme="dark"\]\s+\.button\.ghost/);
  assert.match(css, /subtitle-add-button:hover/);
  assert.match(css, /\.map-decoration/);
  assert.match(css, /preflight-card/);
  assert.match(css, /scene-snowfall/);
  assert.match(css, /100% \{ top: 108%/);
  assert.match(css, /scene-light-flicker/);
  assert.match(css, /scene-rainfall/);
  assert.match(css, /scene-cloud-drift/);
  assert.match(css, /scene-thunder/);
  assert.match(css, /is-playback-paused[\s\S]{0,180}animation-play-state: paused !important/);
  assert.match(css, /scene-visual-effect-card/);
  assert.match(notes, /không tự động ghi/);
  assert.match(notes, /Ctrl\/Cmd \+ Z/);
});

test("keeps preview and FFmpeg render settings aligned", async () => {
  const [page, css, renderer, localServer, resourceCache] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/render-video.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local-render-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/render-resource-cache.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /assetPreviewUrls/);
  assert.match(page, /syncLocalResourceCache/);
  assert.match(page, /buildRenderPayload/);
  assert.match(page, /Render cảnh đang chọn/);
  assert.match(page, /Render toàn clip/);
  assert.match(page, /local-render-detail-card/);
  assert.match(page, /renderStageSteps/);
  assert.match(page, /formatRenderDuration/);
  assert.match(page, /Video đã render · Nối nhanh/);
  assert.match(page, /selectedRenderedClipIds/);
  assert.match(page, /startLocalConcat/);
  assert.match(page, /rendered-clips-card/);
  assert.match(page, /Tải trước URL để render nhanh hơn/);
  assert.match(page, /localResourceCache/);
  assert.match(page, /imageVisible: imageEnabled/);
  assert.match(page, /fps: renderFps/);
  assert.match(page, /playbackMapScale/);
  assert.match(page, /transformOrigin: `\$\{scene\.centerX\}% \$\{scene\.centerY\}%`/);
  assert.match(page, /transitionDuration: previewPlaybackMode \? "0ms"/);
  assert.match(css, /transform-origin: center bottom/);
  assert.match(css, /phone-preview\.is-playing \.popup-resize-handle/);
  assert.match(css, /aspect-ratio: 9 \/ 16/);
  assert.match(css, /preview-control-panel/);
  assert.match(css, /preview-panel-progress/);
  assert.match(css, /preview-audio-toggle/);
  assert.match(css, /preview-replay-button/);
  assert.match(page, /Math\.min\(REVIEW_ZOOM_MAX/);
  assert.match(page, /localStorage\.setItem\(LOCAL_REVIEW_ZOOM_KEY/);
  assert.match(page, /LOCAL_SCENE_STRUCTURE_ZOOM_KEY/);
  assert.match(page, /readSceneStructureZoomPreference/);
  assert.match(page, /localStorage\.setItem\(LOCAL_SCENE_STRUCTURE_ZOOM_KEY/);
  assert.match(page, /onDoubleClick=\{\(\) => openSceneStructureQuickEditor\(item\)\}/);
  assert.match(page, /scene-structure-quick-editor/);
  assert.match(page, /showSceneStructureHoverPreview/);
  assert.match(page, /renderSceneStructureHoverPreview/);
  assert.match(page, /sceneStartDarkOverlayItemsAtTime/);
  assert.match(page, /staticFrame: true/);
  assert.match(page, /startSceneStructureItemDrag/);
  assert.match(page, /sceneStructureItemDragToken/);
  assert.match(page, /playbackEnd = sceneStructureOpen \? sceneStructureScene\.end/);
  assert.match(page, /Lời thuyết minh popup/);
  assert.match(page, /Nội dung từng câu/);
  assert.match(page, /weatherControls/);
  assert.match(css, /scene-structure-quick-editor-overlay/);
  assert.match(css, /scene-structure-card\.is-movable/);
  assert.match(css, /scene-structure-hover-preview/);
  assert.match(css, /\.preview-control-bar \{\s*display: flex;\s*flex-wrap: nowrap;/);
  assert.match(css, /preview-control-bar \.preview-review-toggle span/);
  assert.match(css, /\.preview-control-bar \{\s*overflow: visible;/);
  assert.match(css, /\.preview-ruler-style-popover \{[\s\S]{0,180}position: fixed;/);
  assert.doesNotMatch(css, /editor-accordion-popup\[open\] > \.editor-accordion-content/);
  assert.match(css, /width: min\(100%, 420px\)/);
  assert.match(css, /popup-layout-split/);
  assert.match(css, /popup-theme-ocean/);
  assert.match(css, /popup-text-pop/);
  assert.match(css, /image-url-preview video/);
  assert.match(css, /map-decoration-animated-sticker img,\s*\.map-decoration-animated-sticker video/);
  assert.match(css, /width: min\(220px, 42vw\)/);
  assert.match(css, /--dark-action-bg: #1b3046/);
  assert.match(css, /--dark-danger-bg: #40232c/);
  assert.match(css, /settings-action-buttons \.button\.ghost:hover/);
  assert.match(css, /popup-layout-image-only \.photo-placeholder/);
  assert.match(css, /flex: 1 1 auto/);
  assert.match(css, /editor-section-actions/);
  assert.match(css, /editor-section-action/);
  assert.match(css, /local-render-stage-track/);
  assert.match(css, /local-render-detail-grid/);
  assert.match(renderer, /PREVIEW_REFERENCE_WIDTH = 472/);
  assert.match(renderer, /aspectRatio = project\.aspectRatio === "16:9"/);
  assert.match(renderer, /defaultResolution = aspectRatio === "16:9" \? "1920x1080" : "1080x1920"/);
  assert.match(renderer, /popupPixelHeight/);
  assert.match(renderer, /const geometry = popupSectionGeometry\(/);
  assert.match(renderer, /const height = Math\.min\(/);
  assert.match(renderer, /Number\(popup\.width\)/);
  assert.match(renderer, /Number\(popup\.height\)/);
  assert.match(renderer, /popupImageHeight/);
  assert.match(renderer, /popupContentHeight/);
  assert.match(renderer, /textBlurSharpSource/);
  assert.match(renderer, /alpha\(X,Y\)\*\(1-\(/);
  assert.match(renderer, /alpha\(X,Y\)\*\(/);
  assert.match(renderer, /const animatedStickerSize = Math\.max\(1, Math\.round\(previewPx\(220\)\)\)/);
  assert.match(renderer, /const ffmpegMediaFit = \(width, height, fit = "cover"\)/);
  assert.match(renderer, /force_original_aspect_ratio=decrease,pad=\$\{width\}:\$\{height\}/);
  assert.match(renderer, /imageOnly\s*\?/);
  assert.match(renderer, /zoompan/);
  assert.match(renderer, /scene\.zoom/);
  assert.match(renderer, /scene\.zoomEnd/);
  assert.match(renderer, /normalizeSceneEffects/);
  assert.match(renderer, /Scene complete/);
  assert.match(renderer, /Render stage: joining/);
  assert.match(renderer, /Render stage: mixing background music/);
  assert.match(localServer, /renderJobPayload/);
  assert.match(localServer, /mediaTimeSeconds/);
  assert.match(localServer, /etaSeconds/);
  assert.match(page, /const SNOWFLAKE_SEEDS = Array\.from\(\{ length: 36 \}/);
  assert.match(page, /const RAIN_DROP_SEEDS = Array\.from\(\{ length: 32 \}/);
  assert.match(page, /const CLOUD_SEEDS = Array\.from\(\{ length: 7 \}/);
  assert.match(renderer, /const snowflakeSeeds = Array\.from\(\{ length: 36 \}/);
  assert.match(renderer, /const rainDropSeeds = Array\.from\(\{ length: 32 \}/);
  assert.match(renderer, /const cloudSeeds = Array\.from\(\{ length: 7 \}/);
  assert.match(renderer, /writeWeatherGradientLayer/);
  assert.match(renderer, /weatherPhaseExpression\(cycle, cloud\.delay, "t"\)/);
  assert.match(renderer, /shortest=1:eval=frame/);
  assert.match(renderer, /"-filter_complex_script"/);
  assert.match(renderer, /weatherInputSpecs/);
  assert.match(renderer, /weatherInputIndex/);
  assert.match(renderer, /rainEnabled/);
  assert.match(renderer, /thunderEnabled/);
  assert.match(renderer, /cloudEnabled/);
  assert.match(renderer, /label: "thunder"/);
  assert.match(renderer, /boxblur/);
  assert.match(renderer, /overlay=/);
  assert.match(renderer, /overlayPhase = weatherPhaseExpression/);
  assert.match(renderer, /label: "lightFlicker"/);
  assert.match(renderer, /filter \+= `\$\{composedLabel\}copy\[composed\]`/);
  assert.match(renderer, /backgroundMusicVolume/);
  assert.match(renderer, /scene\.voiceVolume/);
  assert.doesNotMatch(renderer, /createZoomMarker|markerEffects|zoomMarker/);
  assert.match(renderer, /timelineDuration = Math\.max/);
  assert.match(renderer, /filter\(\(scene\) => scene\?\.sceneVisible !== false\)/);
  assert.match(renderer, /Không có cảnh đang hiện để render/);
  assert.match(renderer, /aresample=async=1:first_pts=0/);
  assert.match(renderer, /audioVolume/);
  assert.match(renderer, /resolveVideo/);
  assert.match(renderer, /resolveBackground/);
  assert.match(renderer, /cacheRemoteResource/);
  assert.match(localServer, /\/api\/cache\/sync/);
  assert.match(localServer, /\/api\/rendered-clips/);
  assert.match(localServer, /\/api\/concat/);
  assert.match(localServer, /runConcatJob/);
  assert.match(localServer, /"-c", "copy"/);
  assert.match(localServer, /inspectVideo/);
  assert.match(localServer, /compatibilityKey/);
  assert.match(localServer, /syncProjectResourceCache/);
  assert.match(resourceCache, /collectProjectRemoteResources/);
  assert.match(resourceCache, /cacheRemoteResource/);
  assert.match(resourceCache, /RENDER_CACHE_DIR|cacheRoot/);
  assert.match(renderer, /createMapDecoration/);
  assert.match(renderer, /decorationRenders/);
  assert.match(renderer, /createTextOverlay/);
  assert.match(renderer, /createSubtitleOverlay/);
  assert.match(renderer, /requestedWidth = clamp\(Number\(image\?\.width \?\? 42\) \/ 100, 0\.01, 2\)/);
  assert.match(renderer, /subtitleStyle\.boxWidth/);
  assert.match(renderer, /const borderSvg = borderWidth > 0/);
  assert.match(renderer, /const hasImageBorder = Boolean\(imageRender\.borderPath\)/);
  assert.match(renderer, /const imageFit = image\.transparent === true \? "contain" : "cover"/);
  assert.match(renderer, /animatedStickerFit/);
  assert.match(page, /layerOrder\?: string\[\]/);
  assert.match(page, /previewLayerItems/);
  assert.match(page, /reorderPreviewLayers/);
  assert.match(page, /visiblePreviewLayerItems/);
  assert.match(page, /preview-layer-search/);
  assert.match(page, /explicitlySelectedPreviewLayerToken/);
  assert.match(page, /label: "Phụ đề"/);
  assert.match(page, /sceneImageTransitionOptions/);
  assert.match(page, /value: "fade-black"/);
  assert.match(page, /Hiệu ứng chuyển hình/);
  assert.match(page, /sceneImagePreviewTransition/);
  assert.match(page, /scene-image-fade-black/);
  assert.match(page, /sceneStartDarkEffectProgress/);
  assert.match(page, /easedProgress = progress \* progress \* \(3 - 2 \* progress\)/);
  assert.match(page, /scene-start-dark-mid-opacity/);
  assert.match(page, /elapsed < halfDuration/);
  assert.match(page, /elapsed < halfDuration \+ holdDuration/);
  assert.match(page, /sceneLocalTime < end/);
  assert.match(page, /subtitleStart/);
  assert.match(page, /Thời gian bắt đầu phát tất cả phụ đề/);
  assert.match(page, /holdDuration/);
  assert.match(page, /Thời gian giữ tối/);
  assert.match(page, /editor-section-shortcuts/);
  assert.match(page, /reviewEffectConfiguration/);
  assert.match(page, /reviewTextEffectLabel/);
  assert.match(page, /review-text-detail-list/);
  assert.match(page, /Hiệu ứng tối/);
  assert.match(page, /Chuyển hình/);
  assert.match(renderer, /orderedLayerTokens/);
  assert.match(renderer, /layerToken = \(kind, id\)/);
  assert.match(renderer, /appendSceneImageLayer/);
  assert.match(renderer, /sceneImageTransitionNeedsOverlap/);
  assert.match(renderer, /imageTransitionFilter/);
  assert.match(renderer, /sceneImageFadeBlack/);
  assert.match(renderer, /boxblur=luma_radius/);
  assert.match(renderer, /darkHalfDuration/);
  assert.match(renderer, /darkProgressRaw/);
  assert.match(renderer, /3-2\*\(\$\{darkProgressRaw\}\)/);
  assert.match(renderer, /darkHoldDuration/);
  assert.match(renderer, /darkHoldStart/);
  assert.match(renderer, /darkProgressRaw = `if\(lt\(T/);
  assert.match(renderer, /\$\{darkEnd\}-T/);
  assert.match(renderer, /subtitleOffset/);
  assert.match(renderer, /enable='gte\(t,\$\{imageStart\}\)\*lt\(t,\$\{imageEnd\}\)'/);
  assert.match(css, /grid-template-columns: minmax\(190px, 253px\)/);
  assert.match(css, /preview-layer-search/);
  assert.match(renderer, /requestedBoxWidth/);
  assert.match(renderer, /subtitleRenders/);
  assert.match(renderer, /const normalizeGeqExpression/);
  assert.match(renderer, /const geqRgba/);
  assert.match(renderer, /geqRgba\(\{ alpha: `if\(lt\(X\/W,/);
  assert.ok(
    renderer.indexOf("const filterScriptPath") > renderer.indexOf("[sceneAudioMixed]"),
    "the filter graph must be written after the scene audio mix is appended",
  );
  assert.match(renderer, /typewriter/);
  assert.match(renderer, /subtitleEnabled/);
  assert.match(renderer, /textOverlayRenders/);
  assert.match(renderer, /backgroundIsVideo/);
  assert.match(renderer, /backgroundIsVideo\s*\n\s*\? `\[0:v\]scale=\$\{outputWidth\}:\$\{outputHeight\}:force_original_aspect_ratio=increase,crop=\$\{outputWidth\}:\$\{outputHeight\}/);
  assert.doesNotMatch(renderer, /backgroundIsVideo\s*\n\s*\? `\[0:v\]scale=\$\{outputWidth \* 2\}:\$\{outputHeight \* 2\}/);
  assert.match(renderer, /-stream_loop/);
  assert.match(renderer, /d=1,trim=duration/);
  assert.match(renderer, /popup\.video/);
  assert.match(renderer, /typeof popup\.transparentMedia === "boolean"/);
  assert.match(renderer, /typeof popup\.popupTransparentMedia === "boolean"/);
  assert.match(renderer, /const animatedImageDetected = isAnimatedImageMedia\(imageValue\)/);
  assert.match(renderer, /const image = animatedImage && !resolvedVideo \? null : resolvedImage/);
  assert.match(renderer, /videoFrameSequence/);
  assert.match(renderer, /const writeAnimatedImageFrameSequence/);
  assert.match(renderer, /animatedImage = await writeAnimatedImageFrameSequence/);
  assert.match(renderer, /const writeAnimatedWebpFrameSequence/);
  assert.match(renderer, /addInput\("-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", popup\.video\)/);
  assert.match(renderer, /scene\.popupLayout/);
  assert.match(renderer, /scene\.popupX/);
  assert.match(renderer, /scene\.popupY/);
  assert.match(renderer, /volume=\$\{voiceVolume\.toFixed\(3\)\}/);
  assert.match(renderer, /"-c:v", "copy"/);
  assert.match(renderer, /"-c:a", "aac"/);
  assert.match(renderer, /adelay=\$\{Math\.round\(voiceStart \* 1000\)\}/);
  assert.doesNotMatch(renderer, /fallback-\$\{index \+ 1\}/);
  assert.match(localServer, /--use-system-ca/);
  assert.match(localServer, /\/api\/align-subtitles/);
  assert.match(localServer, /alignSubtitles/);
  assert.match(page, /fileToDataUrl/);
  assert.match(page, /sourceData/);
  assert.match(page, /tự nhận diện/);
  assert.match(localServer, /alpha-v5-auto-grid-local-file/);
  assert.match(localServer, /sourceData/);
  assert.match(renderer, /processSpriteSheetBuffer/);
});

test("auto-detects a solid-background sprite sheet grid", async () => {
  const columns = 6;
  const rows = 5;
  const cellSize = 64;
  const width = columns * cellSize;
  const height = rows * cellSize;
  const raw = Buffer.alloc(width * height * 4);
  for (let index = 3; index < raw.length; index += 4) raw[index] = 255;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      for (let y = 10; y < 54; y += 1) {
        for (let x = 10; x < 54; x += 1) {
          const index = ((row * cellSize + y) * width + column * cellSize + x) * 4;
          raw[index] = 180 + column * 10;
          raw[index + 1] = 60 + row * 20;
          raw[index + 2] = 40;
        }
      }
    }
  }
  const result = await processSpriteSheetBuffer(
    await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    { frameSize: 128, delay: 60 },
  );
  assert.equal(result.detected, true);
  assert.equal(result.columns, columns);
  assert.equal(result.rows, rows);
  assert.equal(result.frameCount, columns * rows);
  assert.equal(result.mode, "regular-grid");
});
