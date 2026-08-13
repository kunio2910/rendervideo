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
  assert.doesNotMatch(html, /history-button|restore-button/);
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
  assert.match(page, /runRenderPreflight/);
  assert.match(page, /indexedDB/);
  assert.match(page, /timelineProgress/);
  assert.match(page, /timeline-playhead-layer/);
  assert.match(page, /startTimelineScrub/);
  assert.match(page, /startTimelinePopupDrag/);
  assert.match(page, /popupStart/);
  assert.match(page, /Bật hiệu ứng zoom bản đồ/);
  assert.match(page, /Thời gian kết thúc zoom/);
  assert.match(page, /Âm lượng nhạc nền/);
  assert.match(page, /Âm lượng thuyết minh/);
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
  assert.match(page, /popupVideo/);
  assert.match(page, /const updatePopupMedia = \(value: string, popupId = selectedPopupId\)/);
  assert.match(page, /copyEditorSection/);
  assert.match(page, /pasteEditorSection/);
  assert.match(page, /editorSectionActions/);
  assert.match(page, /type MapDecorationType/);
  assert.match(page, /mapDecorations/);
  assert.match(page, /addMapDecoration/);
  assert.match(page, /startMapDecorationDrag/);
  assert.match(page, /map-decoration-manager/);
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
  assert.match(page, /height: `min\(\$\{popup\.height \?\? 255\}px, 88%\)`/);
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
  assert.match(page, /subtitle-track/);
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
  assert.match(page, /Cảnh tiếp theo/);
  assert.doesNotMatch(page, /preview-footer.*Background.*Popup/s);
  assert.match(page, /const updateScene[\s\S]{0,180}if \(!hydrated\) return;/);
  assert.doesNotMatch(page, /zoomMarkerEnabled|editor-camera|editor-effects/);
  assert.match(css, /zoom-focus-target/);
  assert.match(page, /event\.key === " "/);
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
  assert.match(css, /preview-fullscreen::before/);
  assert.match(css, /preview-fullscreen-panel/);
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
  assert.match(css, /scene-visual-effect-card/);
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
  assert.match(page, /playbackMapScale/);
  assert.match(page, /transformOrigin: `\$\{scene\.centerX\}% \$\{scene\.centerY\}%`/);
  assert.match(page, /transitionDuration: playing \? "0ms"/);
  assert.match(css, /transform-origin: center bottom/);
  assert.match(css, /phone-preview\.is-playing \.popup-resize-handle/);
  assert.match(css, /aspect-ratio: 9 \/ 16/);
  assert.match(css, /preview-control-panel/);
  assert.match(css, /preview-panel-progress/);
  assert.match(css, /width: min\(100%, 420px\)/);
  assert.match(css, /popup-layout-split/);
  assert.match(css, /popup-theme-ocean/);
  assert.match(css, /popup-text-pop/);
  assert.match(css, /image-url-preview video/);
  assert.match(css, /popup-layout-image-only \.photo-placeholder/);
  assert.match(css, /flex: 1 1 auto/);
  assert.match(css, /editor-section-actions/);
  assert.match(css, /editor-section-action/);
  assert.match(renderer, /PREVIEW_REFERENCE_WIDTH = 472/);
  assert.match(renderer, /aspectRatio = project\.aspectRatio === "16:9"/);
  assert.match(renderer, /defaultResolution = aspectRatio === "16:9" \? "1920x1080" : "1080x1920"/);
  assert.match(renderer, /popupPixelHeight/);
  assert.match(renderer, /const height = popupPixelHeight\(scene\)/);
  assert.match(renderer, /imageOnly\s*\?/);
  assert.match(renderer, /zoompan/);
  assert.match(renderer, /scene\.zoom/);
  assert.match(renderer, /scene\.zoomEnd/);
  assert.match(renderer, /normalizeSceneEffects/);
  assert.match(renderer, /weatherInputSpecs/);
  assert.match(renderer, /weatherInputIndex/);
  assert.match(renderer, /rainEnabled/);
  assert.match(renderer, /thunderEnabled/);
  assert.match(renderer, /cloudEnabled/);
  assert.match(renderer, /thundered/);
  assert.match(renderer, /boxblur/);
  assert.match(renderer, /overlay=/);
  assert.match(renderer, /x: `mod/);
  assert.match(renderer, /lightened/);
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
  assert.match(renderer, /createMapDecoration/);
  assert.match(renderer, /decorationRenders/);
  assert.match(renderer, /createTextOverlay/);
  assert.match(renderer, /createSubtitleOverlay/);
  assert.match(renderer, /subtitleStyle\.boxWidth/);
  assert.match(renderer, /const borderSvg = borderWidth > 0/);
  assert.match(renderer, /const hasImageBorder = Boolean\(imageRender\.borderPath\)/);
  assert.match(renderer, /sceneImageInputIndex \+= hasImageBorder \? 3 : 2/);
  assert.match(renderer, /requestedBoxWidth/);
  assert.match(renderer, /subtitleRenders/);
  assert.match(renderer, /geq=r='r\(X,Y\)':g='g\(X,Y\)':b='b\(X,Y\)':a='if\(lt\(X\/W,/);
  assert.match(renderer, /typewriter/);
  assert.match(renderer, /subtitleEnabled/);
  assert.match(renderer, /textOverlayRenders/);
  assert.match(renderer, /backgroundIsVideo/);
  assert.match(renderer, /backgroundIsVideo\s*\n\s*\? `\[0:v\]scale=\$\{outputWidth\}:\$\{outputHeight\}:force_original_aspect_ratio=increase,crop=\$\{outputWidth\}:\$\{outputHeight\}/);
  assert.doesNotMatch(renderer, /backgroundIsVideo\s*\n\s*\? `\[0:v\]scale=\$\{outputWidth \* 2\}:\$\{outputHeight \* 2\}/);
  assert.match(renderer, /-stream_loop/);
  assert.match(renderer, /d=1,trim=duration/);
  assert.match(renderer, /popup\.video/);
  assert.match(renderer, /scene\.popupLayout/);
  assert.match(renderer, /scene\.popupX/);
  assert.match(renderer, /scene\.popupY/);
  assert.match(renderer, /volume=\$\{voiceVolume\.toFixed\(3\)\}/);
  assert.match(renderer, /"-c:v", "copy"/);
  assert.match(renderer, /"-c:a", "aac"/);
  assert.doesNotMatch(renderer, /adelay=/);
  assert.doesNotMatch(renderer, /fallback-\$\{index \+ 1\}/);
  assert.match(localServer, /--use-system-ca/);
  assert.match(localServer, /\/api\/align-subtitles/);
  assert.match(localServer, /alignSubtitles/);
});
