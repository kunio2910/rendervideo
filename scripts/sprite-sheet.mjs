import sharp from "sharp";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const luminance = (red, green, blue) => red * 0.299 + green * 0.587 + blue * 0.114;

const colorDistance = (red, green, blue, target) => Math.sqrt(
  (red - target[0]) ** 2
  + (green - target[1]) ** 2
  + (blue - target[2]) ** 2,
);

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const fitColorPlane = (samples, fallback) => {
  if (samples.length < 6) return fallback.map((value) => [value, 0, 0]);
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const vectors = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const sample of samples) {
    const values = [1, sample.x, sample.y];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) matrix[row][column] += values[row] * values[column];
      for (let channel = 0; channel < 3; channel += 1) vectors[channel][row] += values[row] * sample.color[channel];
    }
  }
  const solve = (rightHand) => {
    const augmented = matrix.map((row, rowIndex) => [...row, rightHand[rowIndex]]);
    for (let pivot = 0; pivot < 3; pivot += 1) {
      let best = pivot;
      for (let row = pivot + 1; row < 3; row += 1) {
        if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
      }
      if (Math.abs(augmented[best][pivot]) < 0.00001) return null;
      [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
      const divisor = augmented[pivot][pivot];
      for (let column = pivot; column <= 3; column += 1) augmented[pivot][column] /= divisor;
      for (let row = 0; row < 3; row += 1) {
        if (row === pivot) continue;
        const factor = augmented[row][pivot];
        for (let column = pivot; column <= 3; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
    return augmented.map((row) => row[3]);
  };
  const planes = vectors.map(solve);
  return planes.every(Boolean) ? planes : fallback.map((value) => [value, 0, 0]);
};

const estimateAxisStates = (data, info, horizontal) => {
  const length = horizontal ? info.width : info.height;
  const band = Math.min(horizontal ? info.height : info.width, 32);
  const values = Array.from({ length }, (_, index) => {
    let total = 0;
    for (let offset = 0; offset < band; offset += 1) {
      const x = horizontal ? index : offset;
      const y = horizontal ? offset : index;
      const sourceIndex = (y * info.width + x) * info.channels;
      total += luminance(data[sourceIndex], data[sourceIndex + 1], data[sourceIndex + 2]);
    }
    return total / band;
  });
  let low = Math.min(...values);
  let high = Math.max(...values);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const midpoint = (low + high) / 2;
    const lowValues = values.filter((value) => value <= midpoint);
    const highValues = values.filter((value) => value > midpoint);
    if (!lowValues.length || !highValues.length) break;
    low = lowValues.reduce((sum, value) => sum + value, 0) / lowValues.length;
    high = highValues.reduce((sum, value) => sum + value, 0) / highValues.length;
  }
  const threshold = (low + high) / 2;
  return { states: values.map((value) => value > threshold), low, high };
};

const estimateCellSize = (data, info) => {
  const axisRuns = (horizontal) => {
    const { states } = estimateAxisStates(data, info, horizontal);
    const runs = [];
    let state = states[0];
    let start = 0;
    for (let index = 1; index <= states.length; index += 1) {
      const nextState = index < states.length ? states[index] : !state;
      if (nextState === state) continue;
      runs.push(index - start);
      state = nextState;
      start = index;
    }
    const usableRuns = runs.filter((run) => run >= 6 && run <= 160);
    return usableRuns.length
      ? usableRuns.reduce((sum, run) => sum + run, 0) / usableRuns.length
      : 0;
  };

  const horizontal = axisRuns(true);
  const vertical = axisRuns(false);
  const estimated = median([horizontal, vertical].filter((value) => value > 0));
  return clamp(estimated || 32, 8, 160);
};

const estimateCheckerboard = (data, info, cellSize) => {
  const horizontalStates = estimateAxisStates(data, info, true).states;
  const verticalStates = estimateAxisStates(data, info, false).states;
  const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const samples = [0, 0];
  const planeSamples = [[], []];
  const borderDepth = Math.min(32, Math.max(4, Math.round(cellSize / 2)));
  const parityAt = (x, y) => (horizontalStates[x] === verticalStates[y] ? 0 : 1);
  const sample = (x, y) => {
    const sourceIndex = (y * info.width + x) * info.channels;
    const parity = parityAt(x, y);
    const red = data[sourceIndex];
    const green = data[sourceIndex + 1];
    const blue = data[sourceIndex + 2];
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (saturation > 28) return;
    sums[parity][0] += red;
    sums[parity][1] += green;
    sums[parity][2] += blue;
    samples[parity] += 1;
    planeSamples[parity].push({
      x: x / Math.max(1, info.width - 1),
      y: y / Math.max(1, info.height - 1),
      color: [red, green, blue],
    });
  };
  for (let y = 0; y < borderDepth; y += 1) {
    for (let x = 0; x < info.width; x += 1) sample(x, y);
  }
  if (!samples[0] || !samples[1]) return null;
  const colors = sums.map((sum, index) => sum.slice(0, 3).map((value) => value / samples[index]));
  const planes = planeSamples.map((items, index) => fitColorPlane(items, colors[index]));
  const backgroundAt = (parity, x, y) => planes[parity].map((coefficients) => clamp(
    coefficients[0]
      + coefficients[1] * (x / Math.max(1, info.width - 1))
      + coefficients[2] * (y / Math.max(1, info.height - 1)),
    0,
    255,
  ));
  const difference = colorDistance(...colors[0], colors[1]);
  let residual = 0;
  let residualSamples = 0;
  const step = Math.max(1, Math.floor(cellSize / 3));
  const sampleResidual = (x, y) => {
    const sourceIndex = (y * info.width + x) * info.channels;
    const parity = parityAt(x, y);
    residual += colorDistance(data[sourceIndex], data[sourceIndex + 1], data[sourceIndex + 2], backgroundAt(parity, x, y));
    residualSamples += 1;
  };
  for (let y = 0; y < borderDepth; y += step) {
    for (let x = 0; x < info.width; x += step) sampleResidual(x, y);
  }
  const averageResidual = residual / Math.max(1, residualSamples);
  const horizontalTransitions = horizontalStates.reduce((count, state, index) => count + (index > 0 && state !== horizontalStates[index - 1] ? 1 : 0), 0);
  const verticalTransitions = verticalStates.reduce((count, state, index) => count + (index > 0 && state !== verticalStates[index - 1] ? 1 : 0), 0);
  if (difference < 22 || averageResidual > difference * 0.62 || horizontalTransitions < 4 || verticalTransitions < 4) return null;
  return { colors, difference, averageResidual, horizontalStates, verticalStates, backgroundAt };
};

const integralSum = (integral, width, x, y, regionWidth, regionHeight) => {
  const stride = width + 1;
  return integral[(y + regionHeight) * stride + x + regionWidth]
    - integral[y * stride + x + regionWidth]
    - integral[(y + regionHeight) * stride + x]
    + integral[y * stride + x];
};

const detectEmbeddedSpritePanel = (data, info) => {
  const gridWidth = Math.min(160, info.width);
  const gridHeight = Math.min(160, info.height);
  const neutral = new Uint8Array(gridWidth * gridHeight);
  const warm = new Uint8Array(gridWidth * gridHeight);
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const y = Math.min(info.height - 1, Math.floor((gridY + 0.5) * info.height / gridHeight));
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const x = Math.min(info.width - 1, Math.floor((gridX + 0.5) * info.width / gridWidth));
      const sourceIndex = (y * info.width + x) * info.channels;
      const red = data[sourceIndex];
      const green = data[sourceIndex + 1];
      const blue = data[sourceIndex + 2];
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
      const light = luminance(red, green, blue);
      const index = gridY * gridWidth + gridX;
      neutral[index] = saturation < 28 && light >= 25 && light <= 150 ? 1 : 0;
      warm[index] = (red > green + 18 && green > blue + 8 && red > 75)
        || (saturation > 65 && light > 60)
        ? 1
        : 0;
    }
  }
  const neutralIntegral = new Int32Array((gridWidth + 1) * (gridHeight + 1));
  const warmIntegral = new Int32Array((gridWidth + 1) * (gridHeight + 1));
  for (let y = 0; y < gridHeight; y += 1) {
    let neutralRow = 0;
    let warmRow = 0;
    for (let x = 0; x < gridWidth; x += 1) {
      const index = y * gridWidth + x;
      const integralIndex = (y + 1) * (gridWidth + 1) + x + 1;
      neutralRow += neutral[index];
      warmRow += warm[index];
      neutralIntegral[integralIndex] = neutralIntegral[integralIndex - gridWidth - 1] + neutralRow;
      warmIntegral[integralIndex] = warmIntegral[integralIndex - gridWidth - 1] + warmRow;
    }
  }
  const minWidth = Math.max(24, Math.round(gridWidth * 0.2));
  const maxWidth = Math.max(minWidth, Math.round(gridWidth * 0.85));
  const minHeight = Math.max(12, Math.round(gridHeight * 0.06));
  const maxHeight = Math.max(minHeight, Math.round(gridHeight * 0.55));
  let best = null;
  for (let height = minHeight; height <= maxHeight; height += 2) {
    for (let width = minWidth; width <= maxWidth; width += 2) {
      const aspect = width / height;
      if (aspect < 1.35 || aspect > 5.2) continue;
      for (let top = 0; top + height <= gridHeight; top += 2) {
        for (let left = 0; left + width <= gridWidth; left += 2) {
          const area = width * height;
          const neutralFraction = integralSum(neutralIntegral, gridWidth, left, top, width, height) / area;
          const warmFraction = integralSum(warmIntegral, gridWidth, left, top, width, height) / area;
          if (neutralFraction < 0.35 || warmFraction < 0.04) continue;
          const areaFraction = area / (gridWidth * gridHeight);
          const score = neutralFraction
            + Math.min(0.22, warmFraction * 0.7)
            + Math.min(0.14, areaFraction * 1.5)
            - Math.abs(aspect - 2.1) * 0.01;
          if (!best || score > best.score) best = { left, top, width, height, score };
        }
      }
    }
  }
  if (!best || best.score < 0.68) return null;
  // Keep the crop inside the neutral panel. A few pixels of surrounding map
  // artwork can connect all sprite components into one large bounding box.
  const padding = 0;
  const left = Math.max(0, Math.floor(best.left * info.width / gridWidth) - padding);
  const top = Math.max(0, Math.floor(best.top * info.height / gridHeight) - padding);
  const right = Math.min(info.width, Math.ceil((best.left + best.width) * info.width / gridWidth) + padding);
  const bottom = Math.min(info.height, Math.ceil((best.top + best.height) * info.height / gridHeight) + padding);
  return { left, top, width: right - left, height: bottom - top };
};

const estimateSolidBackground = (data, info) => {
  const channels = [[], [], []];
  const step = Math.max(1, Math.floor(Math.min(info.width, info.height) / 120));
  for (let y = 0; y < info.height; y += step) {
    for (let x = 0; x < info.width; x += step) {
      const sourceIndex = (y * info.width + x) * info.channels;
      const red = data[sourceIndex];
      const green = data[sourceIndex + 1];
      const blue = data[sourceIndex + 2];
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
      const light = luminance(red, green, blue);
      if (saturation < 28 && light >= 25 && light <= 150) {
        channels[0].push(red);
        channels[1].push(green);
        channels[2].push(blue);
      }
    }
  }
  if (channels.some((items) => items.length < 12)) return null;
  return channels.map((items) => median(items));
};

const makeSolidForeground = (data, info, background) => {
  const pixels = info.width * info.height;
  const rgba = Buffer.alloc(pixels * 4);
  const alpha = new Uint8Array(pixels);
  const hasSourceAlpha = info.channels === 4;
  for (let index = 0; index < pixels; index += 1) {
    const sourceIndex = index * info.channels;
    const red = data[sourceIndex];
    const green = data[sourceIndex + 1];
    const blue = data[sourceIndex + 2];
    const distance = colorDistance(red, green, blue, background);
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    const light = luminance(red, green, blue);
    const chromaSignal = Math.max(0, saturation - 15) * 3.8;
    const distanceSignal = Math.max(0, distance - 24) * 1.25;
    const backgroundLike = distance < 38 && saturation < 34;
    const neutralBackgroundLike = saturation < 38 && light < 155;
    const score = backgroundLike || neutralBackgroundLike ? 0 : chromaSignal + distanceSignal;
    const estimatedAlpha = clamp(Math.round(((score - 18) / 72) * 255), 0, 255);
    const sourceAlpha = hasSourceAlpha ? data[sourceIndex + 3] : 255;
    const outputAlpha = Math.min(sourceAlpha, estimatedAlpha);
    alpha[index] = outputAlpha;
    const alphaRatio = outputAlpha / 255;
    const safeRatio = Math.max(0.22, alphaRatio);
    rgba[index * 4] = clamp(Math.round((red - background[0] * (1 - alphaRatio)) / safeRatio), 0, 255);
    rgba[index * 4 + 1] = clamp(Math.round((green - background[1] * (1 - alphaRatio)) / safeRatio), 0, 255);
    rgba[index * 4 + 2] = clamp(Math.round((blue - background[2] * (1 - alphaRatio)) / safeRatio), 0, 255);
    rgba[index * 4 + 3] = outputAlpha;
  }
  return { rgba, alpha };
};

const makeForeground = (data, info, cellSize, checker) => {
  const pixels = info.width * info.height;
  const rgba = Buffer.alloc(pixels * 4);
  const alpha = new Uint8Array(pixels);
  const hasSourceAlpha = info.channels === 4;
  for (let index = 0; index < pixels; index += 1) {
    const sourceIndex = index * info.channels;
    const red = data[sourceIndex];
    const green = data[sourceIndex + 1];
    const blue = data[sourceIndex + 2];
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    const parity = checker.horizontalStates[x] === checker.verticalStates[y] ? 0 : 1;
    const background = checker.backgroundAt(parity, x, y);
    const distance = colorDistance(red, green, blue, background);
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    const chromaSignal = Math.max(0, saturation - 10) * 3.6;
    const neutralSignal = luminance(red, green, blue) >= 210
      ? Math.max(0, distance - 90) * 0.45
      : 0;
    const backgroundLike = distance < 55;
    const neutralBackgroundLike = saturation < 30 && luminance(red, green, blue) < 210;
    const mutedBackgroundLike = distance < 110 && saturation < 80 && luminance(red, green, blue) < 190;
    const score = backgroundLike || neutralBackgroundLike || mutedBackgroundLike ? 0 : chromaSignal + neutralSignal;
    const estimatedAlpha = clamp(Math.round(((score - 12) / 46) * 255), 0, 255);
    const sourceAlpha = hasSourceAlpha ? data[sourceIndex + 3] : 255;
    const outputAlpha = Math.min(sourceAlpha, estimatedAlpha);
    alpha[index] = outputAlpha;
    const alphaRatio = outputAlpha / 255;
    const safeRatio = Math.max(0.22, alphaRatio);
    rgba[index * 4] = clamp(Math.round((red - background[0] * (1 - alphaRatio)) / safeRatio), 0, 255);
    rgba[index * 4 + 1] = clamp(Math.round((green - background[1] * (1 - alphaRatio)) / safeRatio), 0, 255);
    rgba[index * 4 + 2] = clamp(Math.round((blue - background[2] * (1 - alphaRatio)) / safeRatio), 0, 255);
    rgba[index * 4 + 3] = outputAlpha;
  }
  return { rgba, alpha };
};

const hasMeaningfulTransparency = (data, info) => {
  if (info.channels < 4) return false;
  const pixelCount = info.width * info.height;
  const sampleStep = Math.max(1, Math.floor(pixelCount / 250000));
  let sampled = 0;
  let transparent = 0;
  let opaque = 0;
  for (let index = 0; index < pixelCount; index += sampleStep) {
    const alpha = data[index * info.channels + 3];
    sampled += 1;
    if (alpha < 16) transparent += 1;
    if (alpha > 220) opaque += 1;
  }
  return transparent / Math.max(1, sampled) > 0.08
    && opaque / Math.max(1, sampled) > 0.01;
};

const makeAlphaForeground = (data, info) => {
  const pixels = info.width * info.height;
  const rgba = Buffer.alloc(pixels * 4);
  const alpha = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const sourceIndex = index * info.channels;
    const outputIndex = index * 4;
    const red = data[sourceIndex];
    const green = data[sourceIndex + 1];
    const blue = data[sourceIndex + 2];
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    const neutralBackdrop = saturation < 32 && luminance(red, green, blue) < 175;
    const sourceAlpha = data[sourceIndex + 3];
    const outputAlpha = neutralBackdrop || sourceAlpha < 220 ? 0 : sourceAlpha;
    rgba[outputIndex] = red;
    rgba[outputIndex + 1] = green;
    rgba[outputIndex + 2] = blue;
    rgba[outputIndex + 3] = outputAlpha;
    alpha[index] = neutralBackdrop ? 0 : sourceAlpha;
  }
  return { rgba, alpha };
};

const detectFrameBoxes = ({ alpha, width, height, cellSize, alphaThreshold = 34, tileSizeOverride, minimumFrameDimensionOverride, minimumPixelCountOverride }) => {
  const tileSize = tileSizeOverride ?? Math.max(8, Math.round(cellSize / 2));
  const tileColumns = Math.ceil(width / tileSize);
  const tileRows = Math.ceil(height / tileSize);
  const tileCount = tileColumns * tileRows;
  const occupied = new Uint8Array(tileCount);
  const pixelCounts = new Uint32Array(tileCount);
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] < alphaThreshold) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const tileIndex = Math.floor(y / tileSize) * tileColumns + Math.floor(x / tileSize);
    occupied[tileIndex] = 1;
    pixelCounts[tileIndex] += 1;
  }
  // The foreground mask already includes soft edges. Dilating occupied tiles
  // here can incorrectly join neighbouring sprites into one giant crop.
  const expanded = occupied;
  const visited = new Uint8Array(tileCount);
  const boxes = [];
  for (let row = 0; row < tileRows; row += 1) {
    for (let column = 0; column < tileColumns; column += 1) {
      const rootIndex = row * tileColumns + column;
      if (!expanded[rootIndex] || visited[rootIndex]) continue;
      const queue = [rootIndex];
      visited[rootIndex] = 1;
      const componentTiles = [];
      while (queue.length) {
        const tileIndex = queue.pop();
        componentTiles.push(tileIndex);
        const currentRow = Math.floor(tileIndex / tileColumns);
        const currentColumn = tileIndex % tileColumns;
        for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
          for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
            if (!deltaX && !deltaY) continue;
            const nextRow = currentRow + deltaY;
            const nextColumn = currentColumn + deltaX;
            if (nextRow < 0 || nextRow >= tileRows || nextColumn < 0 || nextColumn >= tileColumns) continue;
            const nextIndex = nextRow * tileColumns + nextColumn;
            if (expanded[nextIndex] && !visited[nextIndex]) {
              visited[nextIndex] = 1;
              queue.push(nextIndex);
            }
          }
        }
      }
      const originalTiles = componentTiles.filter((tileIndex) => occupied[tileIndex]);
      const pixelCount = originalTiles.reduce((sum, tileIndex) => sum + pixelCounts[tileIndex], 0);
      if (pixelCount < 80) continue;
      const minColumn = Math.min(...originalTiles.map((tileIndex) => tileIndex % tileColumns));
      const maxColumn = Math.max(...originalTiles.map((tileIndex) => tileIndex % tileColumns));
      const minRow = Math.min(...originalTiles.map((tileIndex) => Math.floor(tileIndex / tileColumns)));
      const maxRow = Math.max(...originalTiles.map((tileIndex) => Math.floor(tileIndex / tileColumns)));
      boxes.push({
        left: minColumn * tileSize,
        top: minRow * tileSize,
        right: Math.min(width, (maxColumn + 1) * tileSize),
        bottom: Math.min(height, (maxRow + 1) * tileSize),
        pixelCount,
      });
    }
  }
  const minimumFrameDimension = minimumFrameDimensionOverride
    ?? Math.max(18, Math.round(cellSize * 2));
  const minimumPixelCount = minimumPixelCountOverride ?? 80;
  const filtered = boxes.filter((box) => box.right - box.left >= minimumFrameDimension
    && box.bottom - box.top >= minimumFrameDimension
    && box.pixelCount >= minimumPixelCount);
  if (filtered.length > 64) return [];
  if (filtered.length < 3) return filtered;
  const medianHeight = median(filtered.map((box) => box.bottom - box.top));
  const rowTolerance = Math.max(cellSize * 3, medianHeight * 0.42);
  const rows = [];
  for (const box of filtered.sort((left, right) => left.top - right.top)) {
    const center = (box.top + box.bottom) / 2;
    const row = rows.find((candidate) => Math.abs(candidate.center - center) <= rowTolerance);
    if (row) {
      row.boxes.push(box);
      row.center = row.boxes.reduce((sum, item) => sum + (item.top + item.bottom) / 2, 0) / row.boxes.length;
    } else {
      rows.push({ center, boxes: [box] });
    }
  }
  return rows
    .sort((left, right) => left.center - right.center)
    .flatMap((row) => row.boxes.sort((left, right) => left.left - right.left));
};

const makeFrame = async ({ rgba, width, height, box, frameSize, framePadding = 6 }) => {
  const pad = Math.max(framePadding, Math.round(Math.min(width, height) * 0.006));
  const left = Math.max(0, box.left - pad);
  const top = Math.max(0, box.top - pad);
  const right = Math.min(width, box.right + pad);
  const bottom = Math.min(height, box.bottom + pad);
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: frameSize, height: frameSize, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
};

export const processSpriteSheetBuffer = async (input, options = {}) => {
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 100) {
    return { detected: false, reason: "image-too-small" };
  }
  const rawResult = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let info = rawResult.info;
  let pixels = rawResult.data;
  let cellSize = Math.max(8, Math.round(Math.min(info.width, info.height) / 128));
  let checker = null;
  let mode = "checkerboard";
  let solidBackground = null;
  let panel = null;
  let foreground = null;
  let boxes = [];
  if (hasMeaningfulTransparency(pixels, info)) {
    foreground = makeAlphaForeground(pixels, info);
    boxes = detectFrameBoxes({
      alpha: foreground.alpha,
      width: info.width,
      height: info.height,
      cellSize,
      alphaThreshold: 70,
      tileSizeOverride: cellSize,
      minimumFrameDimensionOverride: Math.max(18, cellSize * 2),
      minimumPixelCountOverride: Math.max(400, Math.round(info.width * info.height * 0.0003)),
    });
    if (boxes.length >= 3) mode = "alpha";
  }
  if (boxes.length < 3) {
    cellSize = estimateCellSize(pixels, info);
    checker = estimateCheckerboard(pixels, info, cellSize);
    if (!checker) {
      panel = detectEmbeddedSpritePanel(pixels, info);
      if (!panel) return { detected: false, reason: "checkerboard-not-detected" };
      const panelRaw = await sharp(input)
        .extract(panel)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      info = panelRaw.info;
      pixels = panelRaw.data;
      solidBackground = estimateSolidBackground(pixels, info);
      if (!solidBackground) return { detected: false, reason: "sprite-panel-background-not-detected" };
      cellSize = Math.max(8, Math.round(Math.min(info.width, info.height) / 8));
      mode = "embedded-panel";
    }
    foreground = checker
      ? makeForeground(pixels, info, cellSize, checker)
      : makeSolidForeground(pixels, info, solidBackground);
    boxes = detectFrameBoxes({
      alpha: foreground.alpha,
      width: info.width,
      height: info.height,
      cellSize,
      alphaThreshold: mode === "embedded-panel" ? 70 : 34,
      tileSizeOverride: mode === "embedded-panel" ? 3 : undefined,
      minimumFrameDimensionOverride: mode === "embedded-panel" ? 8 : undefined,
    });
  }
  if (boxes.length < 3) return { detected: false, reason: "not-enough-frames" };
  const largestBox = Math.max(...boxes.map((box) => Math.max(box.right - box.left, box.bottom - box.top)));
  const frameSize = clamp(
    Math.round(options.frameSize ?? largestBox + cellSize),
    128,
    1024,
  );
  const frames = [];
  for (const box of boxes) {
    frames.push(await makeFrame({
      rgba: foreground.rgba,
      width: info.width,
      height: info.height,
      box,
      frameSize,
      framePadding: mode === "embedded-panel" ? 2 : 6,
    }));
  }
  const delay = clamp(Math.round(options.delay ?? 180), 60, 1000);
  const encoded = await sharp(Buffer.concat(frames), {
    raw: {
      width: frameSize,
      height: frameSize * frames.length,
      channels: 4,
      pageHeight: frameSize,
    },
  }).webp({
    loop: 0,
    delay: frames.map(() => delay),
    quality: clamp(Number(options.quality ?? 86), 40, 100),
    effort: 4,
  }).toBuffer({ resolveWithObject: true });
  return {
    detected: true,
    buffer: encoded.data,
    frameCount: frames.length,
    frameSize,
    delay,
    ...(options.returnFrames ? { frames } : {}),
    cellSize,
    ...(checker ? { checkerDifference: Math.round(checker.difference) } : {}),
    mode,
  };
};
