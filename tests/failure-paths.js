#!/usr/bin/env node
"use strict"

/**
* Reproducible failure-path demonstration.
* Every case prints the exact call, the expected error prefix and the
* observed error, so QA can re-run with: node tests/failure-paths.js
**/

const path = require('path')
const io   = require(path.join('..', 'js', 'sprite-io.js'))

const PALETTE = {
  backgroundColor: '#996600',
  fillColor:       '#ffcc00',
  fillColor2:      '#ff6600',
  blendColor:      '#662200',
}

const goodText = io.serializeSprite(
  io.exportSprite(new Uint8Array(64), false, false, PALETTE))
const goodDoc = io.deserializeSprite(goodText)

const cases = [
  {
    name: 'frame number past the last frame',
    expected: 'invalid frame number: 1',
    call: () => io.importSpriteFrame(goodDoc, 1),
  },
  {
    name: 'negative frame number',
    expected: 'invalid frame number: -1',
    call: () => io.importSpriteFrame(goodDoc, -1),
  },
  {
    name: 'fractional frame number',
    expected: 'invalid frame number: 0.5',
    call: () => io.importSpriteFrame(goodDoc, 0.5),
  },
  {
    name: 'frame number that is not a number',
    expected: 'invalid frame number: 0',
    call: () => io.importSpriteFrame(goodDoc, '0'),
  },
  {
    name: 'corrupt JSON text',
    expected: 'unable to parse octosprite JSON',
    call: () => io.deserializeSprite('{broken'),
  },
  {
    name: 'foreign format identifier',
    expected: 'unrecognized sprite format',
    call: () => {
      const doc = JSON.parse(goodText)
      doc.format = 'png-ish'
      io.parseSpriteDocument(doc)
    },
  },
  {
    name: 'unsupported format version',
    expected: 'unsupported octosprite version',
    call: () => {
      const doc = JSON.parse(goodText)
      doc.version = 99
      io.parseSpriteDocument(doc)
    },
  },
  {
    name: 'malformed palette entry',
    expected: '#RRGGBB',
    call: () => io.exportSprite(new Uint8Array(64), false, false,
      Object.assign({}, PALETTE, { fillColor: 'red' })),
  },
  {
    name: 'pixel outside palette indices 0..3',
    expected: '0..3',
    call: () => {
      const grid = io.bytesToPixels(new Uint8Array(64), false, false)
      grid[0][0] = 7
      io.buildSpriteDocument([{ pixels: grid }],
        { big: false, color: false, palette: PALETTE })
    },
  },
  {
    name: 'empty atlas',
    expected: 'at least one frame',
    call: () => io.exportSpriteAtlas([], false, false, PALETTE),
  },
]

let failures = 0
cases.forEach(testCase => {
  let observed = '(no error thrown)'
  try {
    testCase.call()
  }
  catch (error) {
    observed = error.message
  }
  const ok = observed.indexOf(testCase.expected) !== -1
  if (!ok) failures++
  console.log((ok ? 'OK   ' : 'BAD  ') + '- ' + testCase.name)
  console.log('       expected prefix: ' + testCase.expected)
  console.log('       observed:        ' + observed)
})

console.log(failures ? '\nFAILURE PATH CHECK FAILED' : '\nall failure paths behave as documented')
process.exitCode = failures ? 1 : 0
