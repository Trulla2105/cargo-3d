/**
 * packing.js — 3D Bin Packing Algorithm
 * Strategy: Guillotine / Extreme Points with rotation support
 * Tries up to 6 orientations per box to maximize space usage
 */

'use strict';

/**
 * Returns all valid orientations of a box (up to 3 unique rotations
 * respecting the rule: fragile boxes can't be placed sideways).
 */
function getOrientations(box, allowRotate = true) {
  const { w, d, h, fragile } = box;
  const bases = allowRotate
    ? [
        { w, d, h },    // original
        { w: d, d: w, h },  // rotate 90° on Y
        { w: h, d: d, h: w }, // rotate on Z (only if not fragile)
        { w: w, d: h, h: d },
        { w: h, d: w, h: d },
        { w: d, d: h, h: w },
      ]
    : [{ w, d, h }];

  // Fragile boxes: only keep orientations where original height is on top
  // (simplified: only original and Y-rotation)
  if (fragile === 'yes') {
    return [{ w, d, h }, { w: d, d: w, h }];
  }

  // Deduplicate
  const seen = new Set();
  return bases.filter(o => {
    const key = [o.w, o.d, o.h].sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Main packing function.
 * Returns array of placed items: { boxData, x, y, z, rw, rd, rh }
 */
function packBoxes(boxes, container) {
  const { w: CW, d: CD, h: CH, maxKg } = container;

  // Sort: high-priority + large-volume first, fragile last
  const items = [];
  boxes.forEach(b => {
    for (let i = 0; i < b.qty; i++) {
      items.push({ ...b });
    }
  });

  items.sort((a, b) => {
    const priScore = { high: 2, normal: 1, low: 0 };
    const pA = priScore[a.priority] ?? 1;
    const pB = priScore[b.priority] ?? 1;
    if (pA !== pB) return pB - pA;
    const vA = a.w * a.d * a.h;
    const vB = b.w * b.d * b.h;
    return vB - vA;
  });

  // Space tracking using Extreme Point method
  // Each "extreme point" is a candidate position (x, y, z) for placing a box
  const extremePoints = [{ x: 0, y: 0, z: 0 }];

  const placed = [];
  let totalWeight = 0;

  // Occupation grid (simplified AABB list for collision)
  const occupied = [];

  function collides(x, y, z, rw, rd, rh) {
    for (const o of occupied) {
      if (
        x < o.x2 && x + rw > o.x1 &&
        y < o.y2 && y + rh > o.y1 &&
        z < o.z2 && z + rd > o.z1
      ) return true;
    }
    return false;
  }

  function fitsInContainer(x, y, z, rw, rd, rh) {
    return (
      x + rw <= CW + 0.01 &&
      y + rh <= CH + 0.01 &&
      z + rd <= CD + 0.01 &&
      x >= -0.01 && y >= -0.01 && z >= -0.01
    );
  }

  function addExtremePoints(x, y, z, rw, rd, rh) {
    const newPoints = [
      { x: x + rw, y, z },
      { x, y: y + rh, z },
      { x, y, z: z + rd },
    ];
    newPoints.forEach(p => {
      const exists = extremePoints.some(
        ep => Math.abs(ep.x - p.x) < 0.5 && Math.abs(ep.y - p.y) < 0.5 && Math.abs(ep.z - p.z) < 0.5
      );
      if (!exists && p.x <= CW + 0.01 && p.y <= CH + 0.01 && p.z <= CD + 0.01) {
        extremePoints.push(p);
      }
    });
  }

  // Track placed count per box type
  const placedCount = {};
  boxes.forEach(b => { placedCount[b.id] = 0; });

  for (const item of items) {
    if (totalWeight + item.kg > maxKg) continue;

    const orientations = getOrientations(item, true);
    let bestPlacement = null;

    // Try each extreme point × each orientation
    // Score: prefer lower y (gravity), then lower z, then lower x
    for (const ep of extremePoints) {
      for (const orient of orientations) {
        const { w: rw, d: rd, h: rh } = orient;
        const { x, y, z } = ep;

        if (!fitsInContainer(x, y, z, rw, rd, rh)) continue;
        if (collides(x, y, z, rw, rd, rh)) continue;

        // Support check: at y=0 it's always supported by floor
        // Otherwise check if there's something below
        if (y > 0.5) {
          const supported = occupied.some(o =>
            Math.abs(o.y2 - y) < 0.5 &&
            o.x1 < x + rw && o.x2 > x &&
            o.z1 < z + rd && o.z2 > z
          );
          if (!supported) continue;
        }

        const score = y * 1000000 + z * 1000 + x;
        if (!bestPlacement || score < bestPlacement.score) {
          bestPlacement = { x, y, z, rw, rd, rh, score };
        }
      }
    }

    if (!bestPlacement) continue;

    const { x, y, z, rw, rd, rh } = bestPlacement;
    occupied.push({ x1: x, y1: y, z1: z, x2: x + rw, y2: y + rh, z2: z + rd });
    addExtremePoints(x, y, z, rw, rd, rh);
    totalWeight += item.kg;
    placedCount[item.id] = (placedCount[item.id] || 0) + 1;

    placed.push({
      boxData: item,
      x: x - CW / 2 + rw / 2,   // center offset for Three.js
      y: y + rh / 2,
      z: z - CD / 2 + rd / 2,
      rw, rd, rh
    });
  }

  return { placed, placedCount, totalWeight };
}
