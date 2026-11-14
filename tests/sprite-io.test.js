#!/usr/bin/env node
"use strict"

/**
* Automated round-trip and boundary tests for the sprite import/export
* codec (js/sprite-io.js). Run with:  node tests/sprite-io.test.js
*
* The same byte->pixel->byte rules used here are the ones wired to the
* sprite editor UI, so these tests pin the on-disk octosprite format and
* the editor's existing byte layout at the same time.
**/

const assert = require('assert')
const path   = require('path')
const io     = require(path.join('..', 'js', 'sprite-io.js'))

const PALETTE = {
  backgroundColor: '#996600',
  fillColor:       '#ffcc00',
  fillColor2:      '#FF6600',
  blendColor:      '#662200',
}

let passed = 0
function check(name, body) {
  try {
    body()
    passed++
    console.log('  ok - ' + name)
  }
  catch (error) {
    console.error('  FAIL - ' + name)
    console.error('        ' + (error && error.stack ? error.stack : error))
    process.exitCode = 1
  }
}

function editorLength(big, color) {
  return (big ? 32 : 15) * (color ? 2 : 1)
}

// Deterministic pseudo-random fill so the same input bytes are used
// before and after the change and across every geometry/mode.
function deterministicBytes(seed, size) {
  const bytes = new Uint8Array(64)
  let state = seed
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    bytes[i] = state & 0xff
  }
  return bytes
}

function activeBytesEqual(actual, expected, length) {
  for (let i = 0; i < length; i++) {
    if (actual[i] !== expected[i]) return false
  }
  for (let i = length; i < 64; i++) {
    if (actual[i] !== 0) return false
  }
  return true
}

const GEOMETRIES = [
  { big: false, color: false, label: '8x15 monochrome' },
  { big: false, color: true,  label: '8x15 color' },
  { big: true,  color: false, label: '16x16 monochrome' },
  { big: true,  color: true,  label: '16x16 color' },
]

console.log('single-frame round trips (export -> serialize -> parse -> import):')
GEOMETRIES.forEach((geometry, seed) => {
  const length = editorLength(geometry.big, geometry.color)
  const bytes  = deterministicBytes(seed + 1, length)
  check(geometry.label + ' reproduces editor bytes exactly', () => {
    const doc      = io.exportSprite(bytes, geometry.big, geometry.color, PALETTE)
    const text     = io.serializeSprite(doc)
    const parsed   = io.deserializeSprite(text)
    const imported = io.importSpriteFrame(parsed, 0)
    assert(activeBytesEqual(imported.bytes, bytes, length), 'byte layouts differ')
    assert.strictEqual(imported.big, geometry.big)
    assert.strictEqual(imported.color, geometry.color)
  })
})

console.log('palette index fidelity:')
check('all four indices (0 transparent, 1, 2, 3 blended) survive a round trip', () => {
  const grid = []
  for (let y = 0; y < 15; y++) {
    const row = []
    for (let x = 0; x < 8; x++) row.push((x + y) % 4)
    grid.push(row)
  }
  const bytes = io.pixelsToBytes(grid, false, true)
  const doc   = io.exportSprite(bytes, false, true, PALETTE)
  const back  = io.importSpriteFrame(io.deserializeSprite(io.serializeSprite(doc)), 0)
  const restored = io.bytesToPixels(back.bytes, false, true)
  assert.deepStrictEqual(restored, grid)
})

check('serialized palette is explicit and canonicalized to lowercase hex', () => {
  const doc = io.exportSprite(new Uint8Array(64), false, false, PALETTE)
  const raw = JSON.parse(io.serializeSprite(doc))
  assert.strictEqual(raw.palette.backgroundColor, '#996600')
  assert.strictEqual(raw.palette.fillColor, '#ffcc00')
  assert.strictEqual(raw.palette.fillColor2, '#ff6600')
  assert.strictEqual(raw.palette.blendColor, '#662200')
  assert.strictEqual(raw.frameCount, 1)
  assert.strictEqual(raw.geometry.width, 8)
  assert.strictEqual(raw.geometry.height, 15)
})

console.log('multi-frame atlas round trips:')
check('atlas preserves every frame byte-for-byte and per-pixel palette index', () => {
  const frames = [
    deterministicBytes(7, 60),
    deterministicBytes(8, 60),
    deterministicBytes(9, 60),
  ]
  const doc  = io.exportSpriteAtlas(frames, true, true, PALETTE)
  const text = io.serializeSprite(doc)
  const back = io.importSpriteAtlas(io.deserializeSprite(text))
  assert.strictEqual(back.frames.length, 3)
  frames.forEach((original, index) => {
    assert(activeBytesEqual(back.frames[index], original, 60), 'frame ' + index + ' differs')
    const before = io.bytesToPixels(original, true, true)
    const after  = io.bytesToPixels(back.frames[index], true, true)
    assert.deepStrictEqual(after, before)
  })
  assert.strictEqual(doc.frameCount, 3)
})

check('individual atlas frames are addressable by frame number', () => {
  const frames = [deterministicBytes(3, 15), deterministicBytes(4, 15)]
  const doc = io.deserializeSprite(
    io.serializeSprite(io.exportSpriteAtlas(frames, false, false, PALETTE)))
  const frame1 = io.importSpriteFrame(doc, 1)
  assert(activeBytesEqual(frame1.bytes, frames[1], 15))
})

console.log('failure paths:')
function expectError(name, block, expectedFragment) {
  check(name, () => {
    assert.throws(block, error => {
      if (!expectedFragment) return true
      return String(error.message).indexOf(expectedFragment) !== -1
    })
  })
}

const goodDoc = io.deserializeSprite(
  io.serializeSprite(io.exportSprite(deterministicBytes(2, 15), false, false, PALETTE)))
expectError('frame number above range is rejected',
  () => io.importSpriteFrame(goodDoc, 1), 'invalid frame number: 1')
expectError('negative frame number is rejected',
  () => io.importSpriteFrame(goodDoc, -1), 'invalid frame number: -1')
expectError('fractional frame number is rejected',
  () => io.importSpriteFrame(goodDoc, 0.5), 'invalid frame number')
expectError('non-numeric frame number is rejected',
  () => io.importSpriteFrame(goodDoc, '0'), 'invalid frame number')

expectError('malformed JSON is rejected',
  () => io.deserializeSprite('{not json'), 'unable to parse octosprite JSON')
expectError('foreign format id is rejected', () => {
  const doc = JSON.parse(io.serializeSprite(goodDoc))
  doc.format = 'something-else'
  io.parseSpriteDocument(doc)
}, 'unrecognized sprite format')
expectError('unknown version is rejected', () => {
  const doc = JSON.parse(io.serializeSprite(goodDoc))
  doc.version = 99
  io.parseSpriteDocument(doc)
}, 'unsupported octosprite version')
expectError('bad palette entry is rejected', () => {
  const badPalette = Object.assign({}, PALETTE, { fillColor: 'red' })
  io.exportSprite(new Uint8Array(64), false, false, badPalette)
}, '#RRGGBB')
expectError('palette index > 3 in a frame is rejected', () => {
  const grid = io.bytesToPixels(new Uint8Array(64), false, false)
  grid[0][0] = 4
  io.buildSpriteDocument([{ pixels: grid }], { big: false, color: false, palette: PALETTE })
}, '0..3')
expectError('wrong grid dimensions are rejected', () => {
  const grid = [[0, 0, 0]]
  io.buildSpriteDocument([{ pixels: grid }], { big: false, color: false, palette: PALETTE })
}, 'rows')
expectError('empty frame list is rejected',
  () => io.exportSpriteAtlas([], false, false, PALETTE), 'at least one frame')
expectError('frameCount mismatch is rejected', () => {
  const doc = JSON.parse(io.serializeSprite(goodDoc))
  doc.frameCount = 42
  io.parseSpriteDocument(doc)
}, 'frameCount')

console.log('')
if (process.exitCode) {
  console.error('sprite-io tests FAILED')
}
else {
  console.log('sprite-io tests: ' + passed + ' passed, 0 failed')
}
