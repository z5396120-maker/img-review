const $ = (selector) => document.querySelector(selector);
const SVG = "http://www.w3.org/2000/svg";

const state = {
  assets: [],
  annotations: [],
  activeAssetId: null,
  selectedId: null,
  tool: "select",
  zoom: 1,
  drawing: null,
  undoStack: [],
  redoStack: [],
  pendingComment: null,
  restoringHistory: false,
  gestureStartZoom: 1,
  transforming: null,
  magicMode: "new",
  panning: null,
  spaceDown: false,
  panX: 0,
  panY: 0,
  centerOnNextRender: true,
};

const els = {
  title: $("#review-title"), fileInput: $("#file-input"), tabs: $("#asset-tabs"),
  empty: $("#empty-state"), shell: $("#canvas-shell"), stage: $("#stage"), frame: $("#image-frame"),
  image: $("#main-image"), compareImage: $("#compare-image"), compareLayer: $("#compare-layer"),
  elementPreview: $("#element-preview"),
  svg: $("#annotation-layer"), comments: $("#comments-list"), count: $("#annotation-count"),
  compareEnabled: $("#compare-enabled"), compareAsset: $("#compare-asset"),
  compareSlider: $("#compare-slider"), status: $("#save-status"),
  magicSettings: $("#magic-settings"), magicTolerance: $("#magic-tolerance"),
  magicSampleSize: $("#magic-sample-size"), magicSmooth: $("#magic-smooth"),
  layout: $(".layout"), commentsPanel: $("#comments-panel"), toggleComments: $("#toggle-comments"),
  selectionSummary: $("#selection-summary"), dropOverlay: $("#drop-overlay"),
};

function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function activeAsset() { return state.assets.find((asset) => asset.id === state.activeAssetId); }
function annotationsForActive() { return state.annotations.filter((item) => item.assetId === state.activeAssetId); }
function clamp(value) { return Math.max(0, Math.min(1, value)); }
function pointFromEvent(event) {
  const rect = els.svg.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}
function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}
function pct(value) { return value * 1000; }
function arrowPath(geometry) {
  const x1 = pct(geometry.x1);
  const y1 = pct(geometry.y1);
  const x2 = pct(geometry.x2);
  const y2 = pct(geometry.y2);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const headLength = Math.min(58, Math.max(24, length * .26));
  const headWidth = Math.min(42, Math.max(22, length * .16));
  const shaftWidth = Math.min(14, Math.max(7, length * .045));
  const neckX = x2 - ux * headLength;
  const neckY = y2 - uy * headLength;
  const points = [
    [x1 + nx * shaftWidth / 2, y1 + ny * shaftWidth / 2],
    [neckX + nx * shaftWidth / 2, neckY + ny * shaftWidth / 2],
    [neckX + nx * headWidth / 2, neckY + ny * headWidth / 2],
    [x2, y2],
    [neckX - nx * headWidth / 2, neckY - ny * headWidth / 2],
    [neckX - nx * shaftWidth / 2, neckY - ny * shaftWidth / 2],
    [x1 - nx * shaftWidth / 2, y1 - ny * shaftWidth / 2],
  ];
  return `M ${points.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`;
}
function geometryPoints(annotation) {
  const geometry = annotation.geometry;
  if (annotation.type === "rect") return [
    { x: geometry.x, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
    { x: geometry.x, y: geometry.y + geometry.height },
  ];
  if (annotation.type === "arrow") return [{ x: geometry.x1, y: geometry.y1 }, { x: geometry.x2, y: geometry.y2 }];
  if (annotation.type === "pen") return geometry.points;
  if (annotation.type === "magic") return geometry.paths.flat();
  return [{ x: geometry.x - .015, y: geometry.y - .015 }, { x: geometry.x + .015, y: geometry.y + .015 }];
}
function annotationBounds(annotation) {
  const points = geometryPoints(annotation);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}
function annotationTransform(annotation) {
  const bounds = annotationBounds(annotation);
  return annotation.transform || { translateX: 0, translateY: 0, scale: 1, rotation: 0, originX: bounds.centerX, originY: bounds.centerY };
}
function transformPoint(point, transform) {
  const dx = (point.x - transform.originX) * transform.scale;
  const dy = (point.y - transform.originY) * transform.scale;
  const radians = transform.rotation * Math.PI / 180;
  return {
    x: transform.originX + transform.translateX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: transform.originY + transform.translateY + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}
function svgTransform(transform) {
  return `translate(${pct(transform.translateX)} ${pct(transform.translateY)}) translate(${pct(transform.originX)} ${pct(transform.originY)}) rotate(${transform.rotation}) scale(${transform.scale}) translate(${-pct(transform.originX)} ${-pct(transform.originY)})`;
}
function transformedBounds(bounds, transform) {
  const corners = [
    { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
  ].map((point) => transformPoint(point, transform));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
function transformBadge(text, point, className) {
  const group = svgEl("g", { class: `transform-state-badge ${className}` });
  const label = svgEl("text", { x: pct(point.x), y: pct(point.y) });
  label.textContent = text;
  group.appendChild(label);
  return group;
}
function setZoom(nextZoom, clientX, clientY) {
  const oldZoom = state.zoom;
  const next = Math.max(.3, Math.min(5, nextZoom));
  if (Math.abs(next - oldZoom) < .001) return;
  const shellRect = els.shell.getBoundingClientRect();
  const anchorX = clientX == null ? shellRect.left + shellRect.width / 2 : clientX;
  const anchorY = clientY == null ? shellRect.top + shellRect.height / 2 : clientY;
  const localX = anchorX - shellRect.left;
  const localY = anchorY - shellRect.top;
  const contentX = (localX - state.panX) / oldZoom;
  const contentY = (localY - state.panY) / oldZoom;
  state.zoom = next;
  state.panX = localX - contentX * next;
  state.panY = localY - contentY * next;
  renderCanvas();
}
function colorDistance(data, offset, seed) {
  const dr = data[offset] - seed[0];
  const dg = data[offset + 1] - seed[1];
  const db = data[offset + 2] - seed[2];
  const da = data[offset + 3] - seed[3];
  const redMean = (data[offset] + seed[0]) / 2;
  const redWeight = 2 + redMean / 256;
  const blueWeight = 2 + (255 - redMean) / 256;
  return Math.sqrt(redWeight * dr * dr + 4 * dg * dg + blueWeight * db * db + da * da * .5) / 2;
}
function sampledColor(data, width, height, centerX, centerY, sampleSize) {
  const radius = Math.floor(sampleSize / 2);
  const channels = [[], [], [], []];
  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) channels[channel].push(data[offset + channel]);
    }
  }
  return channels.map((values) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
}
function closeMask(mask, width, height) {
  const dilated = new Uint8Array(mask.length);
  const output = new Uint8Array(mask.length);
  const value = (source, x, y) => x >= 0 && y >= 0 && x < width && y < height ? source[y * width + x] : 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let selected = 0;
    for (let dy = -1; dy <= 1 && !selected; dy += 1) for (let dx = -1; dx <= 1; dx += 1) selected ||= value(mask, x + dx, y + dy);
    dilated[y * width + x] = selected ? 1 : 0;
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let neighbors = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) neighbors += value(dilated, x + dx, y + dy);
    output[y * width + x] = neighbors >= 7 ? 1 : 0;
  }
  return output;
}
function fillSmallHoles(mask, width, height, maxArea = 48) {
  const output = mask.slice();
  const seen = new Uint8Array(mask.length);
  const neighbors = [[-1,0],[1,0],[0,-1],[0,1]];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start]) continue;
    const queue = [start];
    const region = [];
    seen[start] = 1;
    let touchesEdge = false;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      region.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (!touchesEdge && region.length <= maxArea) region.forEach((index) => { output[index] = 1; });
  }
  return output;
}
function pointKey(x, y) { return `${x},${y}`; }
function simplifyPath(points, epsilon) {
  if (points.length < 4) return points;
  const sqDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const segmentDistance = (point, start, end) => {
    let x = start.x;
    let y = start.y;
    let dx = end.x - x;
    let dy = end.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = end.x; y = end.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = point.x - x;
    dy = point.y - y;
    return dx * dx + dy * dy;
  };
  const radial = [points[0]];
  const sqEpsilon = epsilon * epsilon;
  let previous = points[0];
  for (let index = 1; index < points.length; index += 1) {
    if (sqDistance(points[index], previous) > sqEpsilon) {
      radial.push(points[index]);
      previous = points[index];
    }
  }
  if (previous !== points[points.length - 1]) radial.push(points[points.length - 1]);
  const simplified = [radial[0]];
  function step(first, last) {
    let maxDistance = sqEpsilon;
    let split = 0;
    for (let index = first + 1; index < last; index += 1) {
      const distance = segmentDistance(radial[index], radial[first], radial[last]);
      if (distance > maxDistance) { split = index; maxDistance = distance; }
    }
    if (!split) return;
    if (split - first > 1) step(first, split);
    simplified.push(radial[split]);
    if (last - split > 1) step(split, last);
  }
  step(0, radial.length - 1);
  simplified.push(radial[radial.length - 1]);
  return simplified;
}
function traceMaskContours(mask, width, height) {
  const edges = new Map();
  const addEdge = (x1, y1, x2, y2) => {
    const key = pointKey(x1, y1);
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push({ x: x2, y: y2 });
  };
  const selected = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!selected(x, y)) continue;
      if (!selected(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!selected(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!selected(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!selected(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }
  const paths = [];
  while (edges.size) {
    const firstEntry = edges.entries().next().value;
    const startKey = firstEntry[0];
    const [startX, startY] = startKey.split(",").map(Number);
    const path = [{ x: startX, y: startY }];
    let currentKey = startKey;
    let guard = 0;
    while (guard < width * height * 8) {
      guard += 1;
      const candidates = edges.get(currentKey);
      if (!candidates || !candidates.length) break;
      const next = candidates.pop();
      if (!candidates.length) edges.delete(currentKey);
      path.push(next);
      currentKey = pointKey(next.x, next.y);
      if (currentKey === startKey) break;
    }
    if (path.length > 4 && currentKey === startKey) paths.push(path);
  }
  return paths;
}
function maskToPaths(mask, width, height) {
  return traceMaskContours(mask, width, height)
    .map((path) => simplifyPath(path.map(({ x, y }) => ({ x: x / width, y: y / height })), 1.5 / Math.max(width, height)))
    .filter((path) => path.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 64);
}
function pathsToMask(paths, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.beginPath();
  paths.forEach((path) => {
    if (!path.length) return;
    context.moveTo(path[0].x * width, path[0].y * height);
    path.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
    context.closePath();
  });
  context.fill("evenodd");
  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4 + 3] > 0 ? 1 : 0;
  return mask;
}
function combineMasks(existing, incoming, mode) {
  const output = new Uint8Array(existing.length);
  for (let index = 0; index < output.length; index += 1) {
    if (mode === "add") output[index] = existing[index] || incoming[index] ? 1 : 0;
    else if (mode === "subtract") output[index] = existing[index] && !incoming[index] ? 1 : 0;
    else output[index] = incoming[index];
  }
  return output;
}
function masksEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
function maskOverlap(left, right) {
  if (left.length !== right.length) return 0;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] || right[index]) union += 1;
    if (left[index] && right[index]) intersection += 1;
  }
  return union ? intersection / union : 1;
}
function selectedMagicAnnotation() {
  const selected = state.annotations.find((item) => item.id === state.selectedId && item.type === "magic" && item.assetId === state.activeAssetId);
  if (selected) return selected;
  return [...state.annotations].reverse().find((item) => item.type === "magic" && item.assetId === state.activeAssetId);
}
function matchingMagicAnnotation(selection) {
  return annotationsForActive().find((item) => {
    if (item.type !== "magic") return false;
    const existing = pathsToMask(item.geometry.paths, selection.width, selection.height);
    return maskOverlap(existing, selection.mask) >= .97;
  });
}
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll(".tool[data-tool]").forEach((item) => item.classList.toggle("active", item.dataset.tool === tool));
  els.magicSettings.hidden = tool !== "magic";
  els.shell.classList.toggle("select-tool", tool === "select");
  renderCanvas();
}
function brushSeeds(points, width, height) {
  const seeds = [];
  const seen = new Set();
  const add = (x, y) => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(x * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(y * height)));
    const key = `${px},${py}`;
    if (!seen.has(key)) { seen.add(key); seeds.push({ x: px, y: py }); }
  };
  points.forEach((point, index) => {
    if (!index) { add(point.x, point.y); return; }
    const previous = points[index - 1];
    const dx = (point.x - previous.x) * width;
    const dy = (point.y - previous.y) * height;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 12));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      add(previous.x + (point.x - previous.x) * t, previous.y + (point.y - previous.y) * t);
    }
  });
  if (seeds.length <= 96) return seeds;
  const stride = Math.ceil(seeds.length / 96);
  return seeds.filter((_, index) => index % stride === 0).slice(0, 96);
}
function floodMaskFromSeed(data, width, height, seedX, seedY, seed, tolerance) {
  const mask = new Uint8Array(width * height);
  const queued = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const startIndex = seedY * width + seedX;
  queue[tail++] = startIndex;
  queued[startIndex] = 1;
  while (head < tail) {
    const index = queue[head++];
    if (colorDistance(data, index * 4, seed) > tolerance) continue;
    mask[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1, y + 1 < height ? index + width : -1,
      x > 0 && y > 0 ? index - width - 1 : -1,
      x + 1 < width && y > 0 ? index - width + 1 : -1,
      x > 0 && y + 1 < height ? index + width - 1 : -1,
      x + 1 < width && y + 1 < height ? index + width + 1 : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && !queued[neighbor]) { queued[neighbor] = 1; queue[tail++] = neighbor; }
    }
  }
  return mask;
}
async function smartSelectBrush(points) {
  if (!els.image.complete || !els.image.naturalWidth) await els.image.decode();
  const maxDimension = 900;
  const scale = Math.min(1, maxDimension / Math.max(els.image.naturalWidth, els.image.naturalHeight));
  const width = Math.max(1, Math.round(els.image.naturalWidth * scale));
  const height = Math.max(1, Math.round(els.image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(els.image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const sampleSize = Number(els.magicSampleSize.value);
  const tolerance = Number(els.magicTolerance.value);
  const seeds = brushSeeds(points, width, height);
  const mask = new Uint8Array(width * height);
  seeds.forEach(({ x, y }) => {
    const seed = sampledColor(pixels, width, height, x, y, sampleSize);
    const seedMask = floodMaskFromSeed(pixels, width, height, x, y, seed, tolerance);
    for (let index = 0; index < mask.length; index += 1) if (seedMask[index]) mask[index] = 1;
  });
  if (!mask.some((value) => value === 1)) throw new Error("No selectable region found");
  const refinedMask = els.magicSmooth.checked ? fillSmallHoles(closeMask(mask, width, height), width, height) : mask;
  const normalized = maskToPaths(refinedMask, width, height);
  if (!normalized.length) throw new Error("Could not trace the selected region");
  return {
    paths: normalized, seed: points[0], seeds: points, tolerance, sampleSize, smoothEdges: els.magicSmooth.checked,
    pixelCount: refinedMask.reduce((sum, value) => sum + value, 0), mask: refinedMask, width, height,
  };
}
async function smartSelect(point) {
  return smartSelectBrush([point]);
}
async function applyMagicSelection(points, before, mode) {
  const selected = await smartSelectBrush(points);
  let annotation = mode === "new" ? null : selectedMagicAnnotation();
  if (mode === "new") {
    const duplicate = matchingMagicAnnotation(selected);
    if (duplicate) {
      state.selectedId = duplicate.id;
      setTool("select");
      els.status.textContent = "That element is already selected. Its existing operation was preserved.";
      return;
    }
  }
  if (!annotation && mode === "subtract") throw new Error("Create or select a Magic selection before subtracting");
  if (!annotation) {
    const { mask, width, height, ...geometry } = selected;
    annotation = { id: uid(), assetId: state.activeAssetId, type: "magic", comment: "", geometry };
    state.annotations.push(annotation);
  } else {
    const existingMask = pathsToMask(annotation.geometry.paths, selected.width, selected.height);
    const combined = combineMasks(existingMask, selected.mask, mode);
    if (masksEqual(existingMask, combined)) {
      state.selectedId = annotation.id;
      setTool("select");
      els.status.textContent = mode === "add" ? "That region is already selected." : "Selection did not change.";
      return;
    }
    const paths = maskToPaths(combined, selected.width, selected.height);
    const pixelCount = combined.reduce((sum, value) => sum + value, 0);
    if (!paths.length || pixelCount === 0) {
      state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
      state.selectedId = null;
      commitHistory(before);
      els.status.textContent = "Selection is empty.";
      render();
      return;
    }
    annotation.geometry = {
      paths, seed: selected.seed, seeds: selected.seeds, tolerance: selected.tolerance,
      sampleSize: selected.sampleSize, smoothEdges: selected.smoothEdges, pixelCount,
    };
    delete annotation.transform;
  }
  state.selectedId = annotation.id;
  commitHistory(before);
  setTool("select");
  els.status.textContent = `${mode === "new" ? "Selected" : mode === "add" ? "Added to selection" : "Subtracted from selection"}: ${annotation.geometry.pixelCount.toLocaleString()} sampled pixels from ${points.length === 1 ? "1 point" : `${points.length} brush points`}. Drag the element or its handles to transform it.`;
  render();
  requestAnimationFrame(() => els.comments.querySelector(".comment-card.selected textarea")?.focus());
}
function snapshotAnnotations() { return JSON.stringify(state.annotations); }
function commitHistory(before) {
  const after = snapshotAnnotations();
  if (before === after) return false;
  state.undoStack.push(before);
  state.redoStack = [];
  renderHistoryButtons();
  return true;
}
function restoreSnapshot(snapshot) {
  state.restoringHistory = true;
  state.pendingComment = null;
  state.annotations = JSON.parse(snapshot);
  if (!state.annotations.some((item) => item.id === state.selectedId)) state.selectedId = null;
  render();
  state.restoringHistory = false;
}
function commitPendingComment() {
  if (!state.pendingComment || state.restoringHistory) return;
  const { before } = state.pendingComment;
  state.pendingComment = null;
  commitHistory(before);
}
function undo() {
  commitPendingComment();
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshotAnnotations());
  restoreSnapshot(state.undoStack.pop());
}
function redo() {
  commitPendingComment();
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshotAnnotations());
  restoreSnapshot(state.redoStack.pop());
}
function renderHistoryButtons() {
  $("#undo").disabled = state.undoStack.length === 0;
  $("#redo").disabled = state.redoStack.length === 0;
}

function viewportImageBounds() {
  const narrow = window.innerWidth <= 1050;
  const maxWidth = narrow ? Math.max(260, window.innerWidth - 390) : Math.max(320, window.innerWidth - 440);
  const preferredWidth = narrow ? Math.max(420, maxWidth) : Math.min(980, maxWidth);
  return {
    maxWidth: preferredWidth,
    maxHeight: Math.max(220, window.innerHeight - (narrow ? 220 : 184)),
  };
}

function updateImageFrameSize() {
  if (!els.image.naturalWidth || !els.image.naturalHeight) return;
  const { maxWidth, maxHeight } = viewportImageBounds();
  const scale = Math.min(maxWidth / els.image.naturalWidth, maxHeight / els.image.naturalHeight, 1);
  const width = Math.max(1, Math.round(els.image.naturalWidth * scale));
  const height = Math.max(1, Math.round(els.image.naturalHeight * scale));
  els.frame.style.width = `${width}px`;
  els.frame.style.height = `${height}px`;
  els.stage.style.width = `${width}px`;
  els.stage.style.height = `${height}px`;
  return { width, height };
}
function centerCanvas(size) {
  const width = size?.width || els.frame.offsetWidth;
  const height = size?.height || els.frame.offsetHeight;
  const availableWidth = Math.max(0, els.shell.clientWidth);
  const availableHeight = Math.max(0, els.shell.clientHeight);
  state.panX = Math.round((availableWidth - width * state.zoom) / 2);
  state.panY = Math.round((availableHeight - height * state.zoom) / 2);
}
function applyCanvasViewport() {
  els.stage.style.transform = `translate(${Math.round(state.panX)}px, ${Math.round(state.panY)}px) scale(${state.zoom})`;
  els.frame.style.zoom = "";
  els.frame.style.transform = "";
}

function shapeNodes(annotation, index) {
  const g = svgEl("g", { "data-id": annotation.id });
  const content = svgEl("g", { transform: svgTransform(annotationTransform(annotation)) });
  const geometry = annotation.geometry;
  const bounds = annotationBounds(annotation);
  let shape;
  if (annotation.type === "rect") {
    shape = svgEl("rect", { x: pct(geometry.x), y: pct(geometry.y), width: pct(geometry.width), height: pct(geometry.height), rx: 5 });
  } else if (annotation.type === "arrow") {
    shape = svgEl("path", { d: arrowPath(geometry) });
    shape.classList.add("arrow");
  } else if (annotation.type === "pen") {
    shape = svgEl("polyline", { points: geometry.points.map((p) => `${pct(p.x)},${pct(p.y)}`).join(" "), fill: "none" });
  } else if (annotation.type === "magic") {
    const pathData = geometry.paths.map((path) => `M ${path.map((p) => `${pct(p.x)} ${pct(p.y)}`).join(" L ")} Z`).join(" ");
    shape = svgEl("path", { d: pathData, "fill-rule": "evenodd" });
    shape.classList.add("magic");
  } else {
    shape = svgEl("circle", { cx: pct(geometry.x), cy: pct(geometry.y), r: 13 });
  }
  shape.classList.add("annotation-shape");
  if (annotation.id === state.selectedId) shape.classList.add("selected");
  const transform = annotationTransform(annotation);
  const transformed = annotation.transform && (
    Math.abs(transform.translateX) > .0001 || Math.abs(transform.translateY) > .0001 ||
    Math.abs(transform.scale - 1) > .0001 || Math.abs(transform.rotation) > .01
  );
  if (transformed) {
    const sourceShape = shape.cloneNode(true);
    sourceShape.classList.remove("selected");
    sourceShape.classList.add("transform-source");
    g.appendChild(sourceShape);
    g.appendChild(transformBadge("Before", { x: bounds.minX, y: Math.max(.025, bounds.minY - .026) }, "before"));

    const afterBounds = transformedBounds(bounds, transform);
    g.appendChild(transformBadge("After", { x: afterBounds.minX, y: Math.max(.025, afterBounds.minY - .026) }, "after"));
  }
  content.appendChild(shape);

  const anchor = annotation.type === "rect" ? { x: geometry.x, y: geometry.y } :
    annotation.type === "arrow" ? { x: geometry.x1, y: geometry.y1 } :
    annotation.type === "pen" ? geometry.points[0] :
    annotation.type === "magic" ? geometry.seed : geometry;
  const label = svgEl("text", { x: pct(anchor.x) + 10, y: pct(anchor.y) - 10, class: "annotation-label" });
  label.textContent = String(index + 1);
  content.appendChild(label);
  g.appendChild(content);
  g.addEventListener("pointerdown", (event) => {
    if (state.tool !== "select") return;
    event.stopPropagation();
    if (state.selectedId === annotation.id) beginTransform(event, annotation, "move");
    else { state.selectedId = annotation.id; render(); }
  });
  if (annotation.id === state.selectedId && state.tool === "select") g.appendChild(transformHandles(annotation));
  return g;
}

function transformHandles(annotation) {
  const group = svgEl("g", { class: "transform-controls" });
  const bounds = annotationBounds(annotation);
  const transform = annotationTransform(annotation);
  const corners = [
    { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
  ].map((point) => transformPoint(point, transform));
  const outline = svgEl("polygon", { points: corners.map((point) => `${pct(point.x)},${pct(point.y)}`).join(" "), class: "transform-outline" });
  group.appendChild(outline);
  corners.forEach((point) => {
    const handle = svgEl("circle", { cx: pct(point.x), cy: pct(point.y), r: 10, class: "transform-handle scale-handle" });
    handle.addEventListener("pointerdown", (event) => beginTransform(event, annotation, "scale"));
    group.appendChild(handle);
  });
  const top = transformPoint({ x: bounds.centerX, y: bounds.minY }, transform);
  const center = transformPoint({ x: bounds.centerX, y: bounds.centerY }, transform);
  const vx = top.x - center.x;
  const vy = top.y - center.y;
  const magnitude = Math.max(.0001, Math.hypot(vx, vy));
  const rotatePoint = { x: top.x + vx / magnitude * .055, y: top.y + vy / magnitude * .055 };
  group.appendChild(svgEl("line", { x1: pct(top.x), y1: pct(top.y), x2: pct(rotatePoint.x), y2: pct(rotatePoint.y), class: "rotation-stem" }));
  const rotateHandle = svgEl("circle", { cx: pct(rotatePoint.x), cy: pct(rotatePoint.y), r: 11, class: "transform-handle rotate-handle" });
  rotateHandle.addEventListener("pointerdown", (event) => beginTransform(event, annotation, "rotate"));
  group.appendChild(rotateHandle);
  return group;
}

function beginTransform(event, annotation, mode) {
  event.preventDefault();
  event.stopPropagation();
  const start = pointFromEvent(event);
  const before = snapshotAnnotations();
  const hadTransform = Boolean(annotation.transform);
  const initial = { ...annotationTransform(annotation) };
  annotation.transform = { ...initial };
  state.transforming = { annotation, mode, start, initial, before, hadTransform };
  els.svg.setPointerCapture(event.pointerId);
}

function moveTransform(event) {
  if (!state.transforming) return false;
  const current = pointFromEvent(event);
  const { annotation, mode, start, initial } = state.transforming;
  if (mode === "move") {
    annotation.transform.translateX = initial.translateX + current.x - start.x;
    annotation.transform.translateY = initial.translateY + current.y - start.y;
  } else if (mode === "scale") {
    const origin = { x: initial.originX + initial.translateX, y: initial.originY + initial.translateY };
    const startDistance = Math.max(.001, Math.hypot(start.x - origin.x, start.y - origin.y));
    const currentDistance = Math.max(.001, Math.hypot(current.x - origin.x, current.y - origin.y));
    annotation.transform.scale = Math.max(.1, Math.min(8, initial.scale * currentDistance / startDistance));
  } else if (mode === "rotate") {
    const origin = { x: initial.originX + initial.translateX, y: initial.originY + initial.translateY };
    const startAngle = Math.atan2(start.y - origin.y, start.x - origin.x);
    const currentAngle = Math.atan2(current.y - origin.y, current.x - origin.x);
    annotation.transform.rotation = initial.rotation + (currentAngle - startAngle) * 180 / Math.PI;
  }
  renderCanvas();
  return true;
}

function finishTransform(event) {
  if (!state.transforming) return false;
  const { annotation, before, initial, hadTransform } = state.transforming;
  const unchanged = JSON.stringify(annotation.transform) === JSON.stringify(initial);
  if (unchanged && !hadTransform) delete annotation.transform;
  state.transforming = null;
  commitHistory(before);
  render();
  try { els.svg.releasePointerCapture(event.pointerId); } catch (_) { /* no capture */ }
  return true;
}

function renderCanvas() {
  const size = updateImageFrameSize();
  if (state.centerOnNextRender && size) {
    centerCanvas(size);
    state.centerOnNextRender = false;
  }
  els.svg.replaceChildren();
  annotationsForActive().forEach((annotation, index) => els.svg.appendChild(shapeNodes(annotation, index)));
  renderMagicBrushPreview();
  renderElementPreview();
  applyCanvasViewport();
  $("#zoom-reset").textContent = `${Math.round(state.zoom * 100)}%`;
}

function renderMagicBrushPreview() {
  if (!state.drawing || state.drawing.type !== "magic-brush" || state.drawing.points.length < 1) return;
  const preview = svgEl("polyline", {
    points: state.drawing.points.map((point) => `${pct(point.x)},${pct(point.y)}`).join(" "),
    class: "magic-brush-preview",
    fill: "none",
  });
  els.svg.appendChild(preview);
}

function clearElementPreview() {
  const context = els.elementPreview.getContext("2d");
  context.clearRect(0, 0, els.elementPreview.width, els.elementPreview.height);
  els.elementPreview.hidden = true;
  els.elementPreview.style.transform = "none";
}

function renderElementPreview() {
  const annotations = annotationsForActive().filter((item) => item.type === "magic" && (
    item.id === state.selectedId || item.transform
  ));
  if (!annotations.length || !els.image.complete || !els.image.naturalWidth) {
    clearElementPreview();
    return;
  }
  const maxDimension = 1800;
  const sampleScale = Math.min(1, maxDimension / Math.max(els.image.naturalWidth, els.image.naturalHeight));
  const width = Math.max(1, Math.round(els.image.naturalWidth * sampleScale));
  const height = Math.max(1, Math.round(els.image.naturalHeight * sampleScale));
  if (els.elementPreview.width !== width) els.elementPreview.width = width;
  if (els.elementPreview.height !== height) els.elementPreview.height = height;
  const context = els.elementPreview.getContext("2d");
  context.clearRect(0, 0, width, height);
  annotations.forEach((annotation) => {
    const transform = annotationTransform(annotation);
    context.save();
    context.translate(transform.translateX * width, transform.translateY * height);
    context.translate(transform.originX * width, transform.originY * height);
    context.rotate(transform.rotation * Math.PI / 180);
    context.scale(transform.scale, transform.scale);
    context.translate(-transform.originX * width, -transform.originY * height);
    context.beginPath();
    annotation.geometry.paths.forEach((path) => {
      if (!path.length) return;
      context.moveTo(path[0].x * width, path[0].y * height);
      path.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
      context.closePath();
    });
    context.clip("evenodd");
    context.drawImage(els.image, 0, 0, width, height);
    context.restore();
  });
  els.elementPreview.hidden = false;
  els.elementPreview.style.transform = "none";
}

function renderComments() {
  const current = annotationsForActive();
  els.count.textContent = String(current.length);
  els.comments.replaceChildren();
  current.forEach((annotation, index) => {
    const card = document.createElement("article");
    card.className = `comment-card${annotation.id === state.selectedId ? " selected" : ""}`;
    card.innerHTML = `<div class="comment-meta"><span class="comment-identity"><span class="annotation-badge">${index + 1}</span><span class="annotation-type">${annotation.type}</span></span><button class="delete" title="Delete annotation">Delete</button></div><textarea placeholder="Optional: add details AI cannot infer visually"></textarea>`;
    card.querySelector("textarea").value = annotation.comment || "";
    card.querySelector("textarea").addEventListener("input", (event) => {
      if (!state.pendingComment || state.pendingComment.id !== annotation.id) {
        state.pendingComment = { id: annotation.id, before: snapshotAnnotations() };
      }
      annotation.comment = event.target.value;
    });
    card.querySelector("textarea").addEventListener("focus", () => {
      state.selectedId = annotation.id;
      renderCanvas();
      renderSelectionSummary();
    });
    card.querySelector("textarea").addEventListener("blur", commitPendingComment);
    card.querySelector(".delete").addEventListener("click", (event) => {
      event.stopPropagation();
      commitPendingComment();
      const before = snapshotAnnotations();
      state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
      if (state.selectedId === annotation.id) state.selectedId = null;
      commitHistory(before);
      render();
    });
    card.addEventListener("click", () => { state.selectedId = annotation.id; renderCanvas(); renderSelectionSummary(); });
    if (annotation.transform) {
      const transform = document.createElement("div");
      transform.className = "transform-summary";
      transform.innerHTML = `<span>Move ${Math.round(annotation.transform.translateX * 100)}%, ${Math.round(annotation.transform.translateY * 100)}%</span><span>Scale ${Math.round(annotation.transform.scale * 100)}%</span><span>Rotate ${Math.round(annotation.transform.rotation)}°</span><button type="button">Reset</button>`;
      transform.querySelector("button").addEventListener("click", (event) => {
        event.stopPropagation();
        const before = snapshotAnnotations();
        delete annotation.transform;
        commitHistory(before);
        render();
      });
      card.appendChild(transform);
    }
    els.comments.appendChild(card);
  });
}

function renderSelectionSummary() {
  const annotation = state.annotations.find((item) => item.id === state.selectedId && item.assetId === state.activeAssetId);
  els.selectionSummary.replaceChildren();
  if (!annotation) {
    const empty = document.createElement("div");
    empty.className = "selection-empty";
    empty.textContent = "Select an annotation to inspect its geometry and target transform.";
    els.selectionSummary.appendChild(empty);
    return;
  }
  const geometry = annotation.geometry || {};
  const transform = annotationTransform(annotation);
  const rows = [
    ["Type", annotation.type],
    ["Comment", annotation.comment?.trim() ? "Provided" : "Optional"],
  ];
  if (annotation.type === "magic") {
    rows.push(["Pixels", geometry.pixelCount ? geometry.pixelCount.toLocaleString() : "Unknown"]);
    rows.push(["Tolerance", geometry.tolerance ?? "Default"]);
    rows.push(["Sample", geometry.sampleSize ? `${geometry.sampleSize} × ${geometry.sampleSize}` : "Point"]);
  }
  rows.push(["Move", `${Math.round(transform.translateX * 100)}%, ${Math.round(transform.translateY * 100)}%`]);
  rows.push(["Scale", `${Math.round(transform.scale * 100)}%`]);
  rows.push(["Rotate", `${Math.round(transform.rotation)}°`]);
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.selectionSummary.appendChild(row);
  });
}

function renderAssets() {
  els.tabs.replaceChildren();
  els.compareAsset.replaceChildren();
  state.assets.forEach((asset) => {
    const tab = document.createElement("div");
    tab.className = `asset-tab${asset.id === state.activeAssetId ? " active" : ""}`;
    const select = document.createElement("button");
    select.className = "asset-tab-select";
    select.textContent = asset.name;
    select.title = asset.name;
    select.addEventListener("click", () => selectAsset(asset.id));
    const close = document.createElement("button");
    close.className = "asset-tab-close";
    close.textContent = "×";
    close.title = `Close ${asset.name}`;
    close.setAttribute("aria-label", `Close ${asset.name}`);
    close.addEventListener("click", () => closeAsset(asset.id).catch((error) => { els.status.textContent = error.message; }));
    tab.append(select, close);
    els.tabs.appendChild(tab);
    const option = new Option(asset.name, asset.id);
    els.compareAsset.appendChild(option);
  });
  const hasAssets = state.assets.length > 0;
  els.empty.hidden = hasAssets;
  els.shell.hidden = !hasAssets;
  els.compareAsset.disabled = state.assets.length < 2;
  els.compareEnabled.disabled = state.assets.length < 2;
}

async function closeAsset(id) {
  commitPendingComment();
  const index = state.assets.findIndex((asset) => asset.id === id);
  if (index < 0) return;
  const response = await fetch("/api/assets/remove", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not close image");
  state.assets.splice(index, 1);
  state.annotations = state.annotations.filter((item) => item.assetId !== id);
  if (state.activeAssetId === id) {
    const next = state.assets[Math.min(index, state.assets.length - 1)];
    state.activeAssetId = next ? next.id : null;
    state.selectedId = null;
    if (next) els.image.src = next.url;
    else els.image.removeAttribute("src");
  }
  if (els.compareAsset.value === id || state.assets.length < 2) els.compareEnabled.checked = false;
  render();
  els.status.textContent = `Closed ${result.name}.`;
}

function renderCompare() {
  const enabled = els.compareEnabled.checked && state.assets.length > 1;
  els.compareLayer.style.display = enabled ? "block" : "none";
  els.compareAsset.style.display = enabled ? "block" : "none";
  els.compareSlider.style.display = enabled ? "block" : "none";
  if (!enabled) return;
  let compare = state.assets.find((asset) => asset.id === els.compareAsset.value && asset.id !== state.activeAssetId);
  if (!compare) compare = state.assets.find((asset) => asset.id !== state.activeAssetId);
  if (compare) {
    els.compareAsset.value = compare.id;
    els.compareImage.src = compare.url;
  }
  els.compareLayer.style.clipPath = `inset(0 ${100 - Number(els.compareSlider.value)}% 0 0)`;
}

function render() { renderAssets(); renderCanvas(); renderComments(); renderSelectionSummary(); renderCompare(); renderHistoryButtons(); }

function selectAsset(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  state.activeAssetId = id;
  state.selectedId = null;
  state.panX = 0;
  state.panY = 0;
  state.centerOnNextRender = true;
  els.image.src = asset.url;
  render();
}

async function addFiles(files) {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) throw new Error("Drop or paste image files to add them.");
  const added = [];
  els.status.textContent = `Adding ${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"}...`;
  for (const file of imageFiles) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, dataUrl }) });
    if (!response.ok) throw new Error((await response.json()).error || "Upload failed");
    const asset = await response.json();
    state.assets.push(asset);
    added.push(asset);
  }
  if (added[0]) selectAsset(added[0].id);
  else if (!state.activeAssetId && state.assets[0]) selectAsset(state.assets[0].id);
  else render();
  els.status.textContent = `Added ${added.length} image${added.length === 1 ? "" : "s"}.`;
}

let dragDepth = 0;
function hasImageFiles(dataTransfer) {
  return Array.from(dataTransfer?.items || []).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}
function showDropOverlay(show) {
  els.dropOverlay.hidden = !show;
}
function resetDragState() {
  dragDepth = 0;
  showDropOverlay(false);
}
function handleDragEnter(event) {
  if (!hasImageFiles(event.dataTransfer)) return;
  event.preventDefault();
  dragDepth += 1;
  showDropOverlay(true);
}
function handleDragOver(event) {
  if (!hasImageFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  showDropOverlay(true);
}
function handleDragLeave(event) {
  if (!hasImageFiles(event.dataTransfer)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) showDropOverlay(false);
}
function handleDrop(event) {
  if (!hasImageFiles(event.dataTransfer)) return;
  event.preventDefault();
  const files = event.dataTransfer.files;
  resetDragState();
  addFiles(files).catch((error) => { els.status.textContent = error.message; });
}
function handlePaste(event) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  event.preventDefault();
  addFiles(files).catch((error) => { els.status.textContent = error.message; });
}

function canPanFromEvent(event) {
  const canvasTarget = event.target === els.svg || [els.shell, els.stage, els.frame].includes(event.currentTarget);
  return state.spaceDown || event.button === 1 || (state.tool === "select" && canvasTarget);
}
function startPan(event) {
  if (state.panning) return false;
  if (!state.activeAssetId || !canPanFromEvent(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  const captureTarget = event.currentTarget || els.svg;
  const pointerId = event.pointerId ?? "mouse";
  state.panning = {
    pointerId,
    captureTarget,
    x: event.clientX,
    y: event.clientY,
    panX: state.panX,
    panY: state.panY,
  };
  els.shell.classList.add("panning");
  try { if (event.pointerId != null) captureTarget.setPointerCapture(event.pointerId); } catch (_) { /* no capture */ }
  return true;
}
function movePan(event) {
  const pointerId = event.pointerId ?? "mouse";
  if (!state.panning || state.panning.pointerId !== pointerId) return false;
  event.preventDefault();
  state.panX = state.panning.panX + (event.clientX - state.panning.x);
  state.panY = state.panning.panY + (event.clientY - state.panning.y);
  applyCanvasViewport();
  return true;
}
function finishPan(event) {
  const pointerId = event.pointerId ?? "mouse";
  if (!state.panning || state.panning.pointerId !== pointerId) return false;
  const captureTarget = state.panning.captureTarget;
  state.panning = null;
  els.shell.classList.remove("panning");
  try { if (event.pointerId != null) captureTarget.releasePointerCapture(event.pointerId); } catch (_) { /* no capture */ }
  return true;
}

async function startDrawing(event) {
  if (startPan(event)) return;
  if (!state.activeAssetId || state.tool === "select") { state.selectedId = null; render(); return; }
  event.preventDefault();
  const start = pointFromEvent(event);
  const before = snapshotAnnotations();
  if (state.tool === "magic") {
    const mode = event.shiftKey ? "add" : event.altKey ? "subtract" : state.magicMode;
    state.drawing = { type: "magic-brush", points: [start], before, mode };
    els.status.textContent = `${mode === "new" ? "Paint" : mode === "add" ? "Paint to add" : "Paint to subtract"} a Magic selection range, then release.`;
    els.svg.setPointerCapture(event.pointerId);
    renderCanvas();
    return;
  }
  const annotation = { id: uid(), assetId: state.activeAssetId, type: state.tool, comment: "", geometry: {} };
  if (state.tool === "rect") annotation.geometry = { x: start.x, y: start.y, width: 0, height: 0 };
  if (state.tool === "arrow") annotation.geometry = { x1: start.x, y1: start.y, x2: start.x, y2: start.y };
  if (state.tool === "pen") annotation.geometry = { points: [start] };
  if (state.tool === "point") annotation.geometry = start;
  state.annotations.push(annotation);
  state.selectedId = annotation.id;
  state.drawing = { annotation, start, before };
  els.svg.setPointerCapture(event.pointerId);
  if (state.tool === "point") finishDrawing(event);
  render();
}

function moveDrawing(event) {
  if (movePan(event)) return;
  if (moveTransform(event)) return;
  if (!state.drawing) return;
  const current = pointFromEvent(event);
  if (state.drawing.type === "magic-brush") {
    const previous = state.drawing.points[state.drawing.points.length - 1];
    if (Math.hypot(current.x - previous.x, current.y - previous.y) > .003) {
      state.drawing.points.push(current);
      els.status.textContent = `Painting Magic range: ${state.drawing.points.length} points.`;
      renderCanvas();
    }
    return;
  }
  const { annotation, start } = state.drawing;
  if (annotation.type === "rect") annotation.geometry = { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) };
  if (annotation.type === "arrow") Object.assign(annotation.geometry, { x2: current.x, y2: current.y });
  if (annotation.type === "pen") annotation.geometry.points.push(current);
  renderCanvas();
}

function finishDrawing(event) {
  if (finishPan(event)) return;
  if (finishTransform(event)) return;
  if (!state.drawing) return;
  if (state.drawing.type === "magic-brush") {
    const { before, mode } = state.drawing;
    const current = pointFromEvent(event);
    const previous = state.drawing.points[state.drawing.points.length - 1];
    if (Math.hypot(current.x - previous.x, current.y - previous.y) > .001) state.drawing.points.push(current);
    const points = state.drawing.points;
    state.drawing = null;
    els.status.textContent = `${mode === "new" ? "Tracing" : mode === "add" ? "Adding to" : "Subtracting from"} brushed selection...`;
    renderCanvas();
    applyMagicSelection(points, before, mode).catch((error) => {
      els.status.textContent = `Smart select failed: ${error.message}`;
      renderCanvas();
    });
    try { els.svg.releasePointerCapture(event.pointerId); } catch (_) { /* no capture */ }
    return;
  }
  const { annotation, before } = state.drawing;
  state.drawing = null;
  const tooSmallRect = annotation.type === "rect" && annotation.geometry.width < .005 && annotation.geometry.height < .005;
  const tooSmallArrow = annotation.type === "arrow" && Math.hypot(
    annotation.geometry.x2 - annotation.geometry.x1,
    annotation.geometry.y2 - annotation.geometry.y1,
  ) < .012;
  const tooSmall = tooSmallRect || tooSmallArrow;
  if (tooSmall) {
    state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
    state.selectedId = null;
  } else {
    commitHistory(before);
  }
  render();
  requestAnimationFrame(() => els.comments.querySelector(".comment-card.selected textarea")?.focus());
  try { els.svg.releasePointerCapture(event.pointerId); } catch (_) { /* no capture */ }
}

function payload() {
  return { title: els.title.value.trim() || "Img Review", assets: state.assets.map(({ id, name }) => ({ id, name })), annotations: state.annotations };
}

async function saveReview() {
  els.status.textContent = "Saving...";
  const response = await fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Save failed");
  els.status.textContent = `Saved ${result.annotations} annotation${result.annotations === 1 ? "" : "s"}.`;
}

async function submitToCodex() {
  els.status.textContent = "Building AI task...";
  const response = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Submit failed");
  try { await navigator.clipboard.writeText(result.prompt); } catch (_) { /* Clipboard may require browser permission. */ }
  els.status.textContent = `Ready for Codex. Task: ${result.taskPath}. Return to chat and send “执行已提交的视觉修改”.`;
}

function download(name, type, content) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function markdown() {
  const data = payload();
  const names = Object.fromEntries(data.assets.map((asset) => [asset.id, asset.name]));
  const lines = [`# ${data.title}`, ""];
  data.annotations.forEach((item, index) => lines.push(`## ${index + 1}. ${names[item.assetId] || item.assetId}`, "", `- Type: \`${item.type}\``, `- Comment: ${item.comment || "No comment"}`, `- Geometry: \`${JSON.stringify(item.geometry)}\``, ""));
  return lines.join("\n");
}

async function init() {
  const data = await (await fetch("/api/session")).json();
  els.shell.classList.toggle("select-tool", state.tool === "select");
  state.assets = data.assets || [];
  if (data.saved) {
    state.annotations = data.saved.annotations || [];
    els.title.value = data.saved.title || "Img Review";
  }
  if (state.assets[0]) selectAsset(state.assets[0].id); else render();
}

document.querySelectorAll(".tool[data-tool]").forEach((button) => button.addEventListener("click", () => {
  setTool(button.dataset.tool);
}));
document.querySelectorAll("[data-magic-mode]").forEach((button) => button.addEventListener("click", () => {
  state.magicMode = button.dataset.magicMode;
  document.querySelectorAll("[data-magic-mode]").forEach((item) => item.classList.toggle("active", item === button));
}));
document.querySelectorAll("[data-file-proxy]").forEach((input) => input.addEventListener("change", (event) => addFiles(event.target.files).catch((error) => els.status.textContent = error.message)));
els.fileInput.addEventListener("change", (event) => addFiles(event.target.files).catch((error) => els.status.textContent = error.message));
window.addEventListener("dragenter", handleDragEnter);
window.addEventListener("dragover", handleDragOver);
window.addEventListener("dragleave", handleDragLeave);
window.addEventListener("drop", handleDrop);
window.addEventListener("paste", handlePaste);
window.addEventListener("resize", () => {
  state.centerOnNextRender = true;
  renderCanvas();
});
els.image.addEventListener("load", () => {
  state.centerOnNextRender = true;
  renderCanvas();
});
els.svg.addEventListener("pointerdown", startDrawing);
els.svg.addEventListener("pointermove", moveDrawing);
els.svg.addEventListener("pointerup", finishDrawing);
els.svg.addEventListener("pointercancel", finishDrawing);
els.shell.addEventListener("pointerdown", startPan);
els.shell.addEventListener("pointermove", movePan);
els.shell.addEventListener("pointerup", finishPan);
els.shell.addEventListener("pointercancel", finishPan);
els.stage.addEventListener("pointerdown", startPan);
els.stage.addEventListener("pointermove", movePan);
els.stage.addEventListener("pointerup", finishPan);
els.stage.addEventListener("pointercancel", finishPan);
els.frame.addEventListener("pointerdown", startPan);
els.frame.addEventListener("pointermove", movePan);
els.frame.addEventListener("pointerup", finishPan);
els.frame.addEventListener("pointercancel", finishPan);
els.svg.addEventListener("mousedown", startPan);
els.stage.addEventListener("mousedown", startPan);
els.frame.addEventListener("mousedown", startPan);
els.shell.addEventListener("mousedown", startPan);
window.addEventListener("mousemove", movePan);
window.addEventListener("mouseup", finishPan);
$("#zoom-in").addEventListener("click", () => setZoom(state.zoom + .1));
$("#zoom-out").addEventListener("click", () => setZoom(state.zoom - .1));
$("#zoom-reset").addEventListener("click", () => setZoom(1));
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
els.compareEnabled.addEventListener("change", renderCompare);
els.compareAsset.addEventListener("change", renderCompare);
els.compareSlider.addEventListener("input", renderCompare);
els.magicTolerance.addEventListener("input", () => { $("#magic-tolerance-value").value = els.magicTolerance.value; });
document.querySelectorAll("[data-inspector-tab]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-inspector-tab]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll("[data-inspector-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.inspectorPanel === button.dataset.inspectorTab));
}));
els.toggleComments.addEventListener("click", () => {
  const collapsed = !els.commentsPanel.classList.contains("collapsed");
  els.commentsPanel.classList.toggle("collapsed", collapsed);
  els.layout.classList.toggle("annotations-collapsed", collapsed);
  els.toggleComments.setAttribute("aria-expanded", String(!collapsed));
  els.toggleComments.setAttribute("aria-label", collapsed ? "Expand annotations" : "Collapse annotations");
  els.toggleComments.title = collapsed ? "Expand annotations" : "Collapse annotations";
});
els.shell.addEventListener("wheel", (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const sensitivity = event.deltaMode === 1 ? .045 : .0025;
  setZoom(state.zoom * Math.exp(-event.deltaY * sensitivity), event.clientX, event.clientY);
}, { passive: false });
els.shell.addEventListener("gesturestart", (event) => {
  event.preventDefault();
  state.gestureStartZoom = state.zoom;
}, { passive: false });
els.shell.addEventListener("gesturechange", (event) => {
  event.preventDefault();
  setZoom(state.gestureStartZoom * event.scale, event.clientX, event.clientY);
}, { passive: false });
$("#save-review").addEventListener("click", () => saveReview().catch((error) => els.status.textContent = error.message));
$("#submit-codex").addEventListener("click", () => submitToCodex().catch((error) => els.status.textContent = error.message));
$("#submit-codex-footer").addEventListener("click", () => submitToCodex().catch((error) => els.status.textContent = error.message));
$("#export-json").addEventListener("click", () => download("annotations.json", "application/json", JSON.stringify(payload(), null, 2)));
$("#export-md").addEventListener("click", () => download("review.md", "text/markdown", markdown()));
window.addEventListener("keydown", (event) => {
  const editable = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  if (event.code === "Space" && !editable) {
    state.spaceDown = true;
    els.shell.classList.add("pan-ready");
    event.preventDefault();
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId && !editable) {
    const before = snapshotAnnotations();
    state.annotations = state.annotations.filter((item) => item.id !== state.selectedId);
    state.selectedId = null;
    commitHistory(before);
    render();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  state.spaceDown = false;
  els.shell.classList.remove("pan-ready");
});

init().catch((error) => { els.status.textContent = `Could not load session: ${error.message}`; });
