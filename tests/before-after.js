#!/usr/bin/env node
"use strict"

/**
* Before/after comparison on one fixed set of inputs.
*
* "Before" = the editor's existing byte layout / save representation
*            (hex bytes in the sprite editor text box), which is unchanged
*            by this work.
* "After"  = bytes reconstructed after export -> serialize -> parse ->
*            import through the new octosprite pipeline.
*
* Outputs a machine-readable JSON report to tests/before-after.json and a
* human-readable summary to stdout.
**/

const fs   = require('fs')
const path = require('path')
const io   = require(path.join('..', 'js', 'sprite-io.js'))

const PALETTE = {
  backgroundColor: '#996600',
  fillColor:       '#ffcc00',
  fillColor2:      '#ff6600',
  blendColor:      '#662200',
}

function hex(bytes, length) {
  return Array.from(bytes.slice(0, length))
    .map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

function seed(seedValue, size) {
  const out = new Uint8Array(64)
  let state = seedValue
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    out[i] = state & 0xff
  }
  return out
}

const cases = [
  { name: 'single 8x15 monochrome', big: false, color: false, mode: 'frame',
    frames: [seed(101, 15)] },
  { name: 'single 8x15 color',      big: false, color: true,  mode: 'frame',
    frames: [seed(202, 30)] },
  { name: 'single 16x16 monochrome', big: true, color: false, mode: 'frame',
    frames: [seed(303, 32)] },
  { name: 'single 16x16 color',     big: true,  color: true,  mode: 'frame',
    frames: [seed(404, 60)] },
  { name: 'multi-frame atlas 16x16 color (3 frames)', big: true, color: true,
    mode: 'atlas', frames: [seed(501, 60), seed(502, 60), seed(503, 60)] },
]

const report = []
let allIdentical = true

cases.forEach(testCase => {
  const length = (testCase.big ? 32 : 15) * (testCase.color ? 2 : 1)
  const doc = testCase.mode === 'atlas'
    ? io.exportSpriteAtlas(testCase.frames, testCase.big, testCase.color, PALETTE)
    : io.exportSprite(testCase.frames[0], testCase.big, testCase.color, PALETTE)
  const text = io.serializeSprite(doc)
  const parsed = io.deserializeSprite(text)

  const frameResults = testCase.frames.map((original, frameNumber) => {
    const imported = io.importSpriteFrame(parsed, frameNumber)
    const beforeBytes = Array.from(original.slice(0, length))
    const afterBytes  = Array.from(imported.bytes.slice(0, length))
    const identical = beforeBytes.every((value, index) => value === afterBytes[index])

    const beforePixels = io.bytesToPixels(original, testCase.big, testCase.color)
    const afterPixels  = io.bytesToPixels(imported.bytes, testCase.big, testCase.color)
    const pixelsIdentical = JSON.stringify(beforePixels) === JSON.stringify(afterPixels)
    if (!identical || !pixelsIdentical) allIdentical = false

    return {
      frame: frameNumber,
      bytesIdentical: identical,
      paletteIndicesIdentical: pixelsIdentical,
      beforeHex: hex(original, length),
      afterHex:  hex(imported.bytes, length),
    }
  })

  report.push({
    case: testCase.name,
    mode: testCase.mode,
    geometry: doc.geometry.width + 'x' + doc.geometry.height +
      (testCase.color ? ' color' : ' monochrome'),
    serializedBytes: text.length,
    palette: parsed.palette,
    frames: frameResults,
  })
})

fs.writeFileSync(path.join(__dirname, 'before-after.json'),
  JSON.stringify({ allIdentical: allIdentical, results: report }, null, 2))

console.log('before/after comparison on the same fixed inputs (editor save bytes vs re-imported bytes)')
report.forEach(entry => {
  console.log('\n[' + entry.case + '] mode=' + entry.mode +
    ' geometry=' + entry.geometry + ' file=' + entry.serializedBytes + ' bytes')
  console.log('  palette: ' + JSON.stringify(entry.palette))
  entry.frames.forEach(frame => {
    console.log('  frame ' + frame.frame +
      ' bytesIdentical=' + frame.bytesIdentical +
      ' paletteIndicesIdentical=' + frame.paletteIndicesIdentical)
    console.log('    before: ' + frame.beforeHex)
    console.log('    after:  ' + frame.afterHex)
  })
})
console.log('\nALL IDENTICAL: ' + allIdentical)
process.exitCode = allIdentical ? 0 : 1
