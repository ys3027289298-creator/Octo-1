#!/usr/bin/env node
"use strict"

/**
* Resource and memory bound verification for sprite import/export.
*
* Derives analytic bounds and checks measured allocations against them.
* Chip-8 sprite geometry is fixed and tiny, so every bound is a small
* constant per frame plus a linear term in the frame count.
**/

const path = require('path')
const io   = require(path.join('..', 'js', 'sprite-io.js'))

const PALETTE = {
  backgroundColor: '#996600',
  fillColor:       '#ffcc00',
  fillColor2:      '#ff6600',
  blendColor:      '#662200',
}

function frame(big, color) {
  const g = io.spriteGeometry(big, color)
  const pixels = []
  for (let y = 0; y < g.rows; y++) {
    const row = []
    for (let x = 0; x < g.cols; x++) row.push((x + y) % 4)
    pixels.push(row)
  }
  return { pixels }
}

function measure(name, big, color, frameCount) {
  const frames = Array.from({ length: frameCount }, () => frame(big, color))
  const before = process.memoryUsage().heapUsed
  const doc = io.buildSpriteDocument(frames, { big, color, palette: PALETTE })
  const text = io.serializeSprite(doc)
  const parsed = io.deserializeSprite(text)
  const atlas = io.importSpriteAtlas(parsed)
  const after = process.memoryUsage().heapUsed

  const g = io.spriteGeometry(big, color)
  const pixelsPerFrame = g.rows * g.cols
  const bytesPerFrame = g.bytesPerLayer * g.layers

  // Analytic bounds (generous, rounded):
  //  - editor byte storage: 64 bytes/frame max (fixed Uint8Array(64))
  //  - pixel grid storage: at most 4 bytes/JS number * pixels + row arrays
  //  - serialized JSON: fixed header/palette (~340 bytes) + per-pixel token
  //    of at most 3 chars ("0..3", comma) => <= 340 + 3*pixelsPerFrame*N
  const jsonBound = 340 + 3 * pixelsPerFrame * frameCount
  const editorBound = 64 * frameCount

  if (atlas.frames.length !== frameCount ||
      !atlas.frames.every(f => f.length === 64 && f.byteLength === 64)) {
    throw new Error(name + ' atlas frame storage has the wrong shape')
  }

  console.log(
    name.padEnd(34),
    'frames=' + String(frameCount).padStart(3),
    'json=' + String(text.length).padStart(6) + 'B (bound ' + jsonBound + 'B)',
    'editorBytes=' + (bytesPerFrame * frameCount) + 'B (cap ' + editorBound + 'B)',
    'heapDelta=' + (after - before) + 'B')

  if (text.length > jsonBound) throw new Error(name + ' exceeded JSON size bound')
  if (bytesPerFrame * frameCount > editorBound) throw new Error(name + ' exceeded editor byte bound')
  return { text, jsonBound, editorBound, pixelsPerFrame, bytesPerFrame }
}

measure('8x15 monochrome, 1 frame',   false, false, 1)
measure('8x15 color, 1 frame',        false, true,  1)
measure('16x16 monochrome, 1 frame',  true,  false, 1)
measure('16x16 color, 1 frame',       true,  true,  1)
measure('16x16 color, 16 frames',     true,  true,  16)
measure('16x16 color, 256 frames',    true,  true,  256)

// Frame-count hard cap enforced by the codec.
let capError = null
try {
  io.buildSpriteDocument(
    Array.from({ length: 65536 }, () => frame(true, true)),
    { big: true, color: true, palette: PALETTE })
}
catch (error) { capError = error.message }
console.log('\nframe cap (65535) enforced:', capError)
if (!/65535/.test(capError || '')) process.exitCode = 1

console.log('\nconstant per-sprite editor footprint: Uint8Array(64) = 64 bytes,')
console.log('regardless of geometry; max single-sprite serialized payload measured above.')
