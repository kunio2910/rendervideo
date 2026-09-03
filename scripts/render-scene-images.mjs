const finiteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const boundedSceneTime = (value, duration) => {
  const time = Math.max(0, finiteNumber(value, 0));
  const safeDuration = Number(duration);
  return Number.isFinite(safeDuration) ? Math.min(Math.max(0, safeDuration), time) : time;
};

const sceneImageTransitionValues = [
  "cut",
  "crossfade",
  "fade-black",
  "slide-left",
  "slide-right",
  "zoom",
  "blur",
];

export const normalizeSceneImageTransition = (value) =>
  sceneImageTransitionValues.includes(String(value)) ? String(value) : "cut";

export const sceneImageTransitionEnd = (image) => {
  const start = Math.max(0, finiteNumber(image?.start, 0));
  const transitionDurationValue = Number(image?.transitionDuration ?? 0.5);
  const legacyDuration = Math.max(
    0.1,
    Number.isFinite(transitionDurationValue) && transitionDurationValue !== 0
      ? transitionDurationValue
      : 0.5,
  );
  const explicitEnd = Number(image?.transitionEnd);
  const end = Number.isFinite(explicitEnd) ? explicitEnd : start + legacyDuration;
  return Math.max(start + 0.1, end);
};

export const sceneImageTransitionDuration = (image) =>
  normalizeSceneImageTransition(image?.transition) === "cut"
    ? 0
    : Math.max(
        0.1,
        sceneImageTransitionEnd(image) - Math.max(0, finiteNumber(image?.start, 0)),
      );

export const sceneImageTransitionNeedsOverlap = (transition) =>
  transition === "crossfade" || transition === "slide-left" || transition === "slide-right";

export const sortSceneImagesByStart = (images) => (Array.isArray(images) ? images : [])
  .map((image, originalIndex) => ({
    image,
    originalIndex,
    start: Math.max(0, finiteNumber(image?.start, 0)),
  }))
  .sort((left, right) => left.start - right.start || left.originalIndex - right.originalIndex)
  .map(({ image }) => image);

export const sceneImagePlaybackEndAt = (images, imageIndex, duration) => {
  const image = images[imageIndex];
  if (!image) return 0;

  const safeDuration = Math.max(0.1, finiteNumber(duration, 0.1));
  const imageStart = boundedSceneTime(image.start, safeDuration);
  const imageDurationValue = Number(image?.duration ?? safeDuration);
  const imageDuration = Number.isFinite(imageDurationValue) && imageDurationValue !== 0
    ? imageDurationValue
    : 0.1;
  const baseEnd = imageStart + Math.max(0.1, imageDuration);
  const imageTransition = normalizeSceneImageTransition(image.transition);
  const ownTransitionEnd = imageTransition === "cut"
    ? imageStart
    : sceneImageTransitionEnd(image);
  const imageEnd = Math.min(safeDuration, Math.max(baseEnd, ownTransitionEnd));
  const nextImage = images[imageIndex + 1];
  if (!nextImage) return imageEnd;

  const nextStart = boundedSceneTime(nextImage.start, safeDuration);
  const nextTransition = normalizeSceneImageTransition(nextImage.transition);
  if (!sceneImageTransitionNeedsOverlap(nextTransition)) return imageEnd;

  const overlapEnd = nextStart + sceneImageTransitionDuration(nextImage);
  return Math.min(safeDuration, Math.max(imageEnd, overlapEnd));
};
