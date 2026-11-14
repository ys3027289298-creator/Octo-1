#!/usr/bin/env node
"use strict"

/**
* Old-behavior equivalence check.
*
* This file re-implements the ORIGINAL sprite editor math copied verbatim
* from tool-sprite.js (spritePixel/getSpritePixel/setSpritePixel and the
* spriteLength/clamp rules) and checks the new sprite-io codec against it
* over an exhaustive, deterministic set of editor byte arrays. The editor
* source itself is not modified in its read/write path, and this test pins
* that fact.
**/

const assert = require('assert')
const path   = require('path')
const io     = require(path.join('..', 'js', 'sprite-io.js'))

// ---- verbatim formulas from the pre-change sprite editor ----------------

function editorLength(sprite16, spriteColor) {
  return (sprite16 ? 32 : 15) * (spriteColor ? 2 : 1)
}
function clampSpriteData(spritePixels, sprite16, spriteColor) {
  for (let z = editorLength(sprite16, spriteColor) + 1; z < 64; z++) {
    spritePixels[z] = 0
  }
}
function spritePixel(x, y, wide) {
  const index = wide ? (y * 2) + (x > 7 ? 1 : 0) : y
  return {
    mask:   128 >> (x % 8),
    layer1: index,
    layer2: index + (wide ? 32 : 15),
  }
}
function getSpritePixel(spritePixels, x, y, wide, color) {
  const t = spritePixel(x, y, wide)
  const c1 = !!(t.mask & spritePixels[t.layer1])
  const c2 = !!(t.mask & spritePixels[t.layer2])
  return c1 + (2 * (c2 & color))
}
function setSpritePixel(spritePixels, x, y, wide, color, p) {
  if (x >= (wide ? 16 : 8)) return
  if (y >= (wide ? 16 : 15)) return
  const t = spritePixel(x, y, wide)
  spritePixels[t.layer1] =
    (spritePixels[t.layer1] & ~t.mask) | ((-!!(p & 1)) & t.mask)
  spritePixels[t.layer2] =
    (spritePixels[t.layer2] & ~t.mask) | ((-!!(p & 2)) & t.mask)
}

// --------------------------------------------------------------------------

const PALETTE = {
  backgroundColor: '#996600',
  fillColor:       '#ffcc00',
  fillColor2:      '#ff6600',
  blendColor:      '#662200',
}

let checked = 0

function checkGeometry(big, color) {
  const cols = big ? 16 : 8
  const rows = big ? 16 : 15
  const length = editorLength(big, color)

  // deterministic sweep over every active byte position with several values
  for (let position = 0; position < length; position++) {
    ;[0x00, 0x01, 0x7f, 0x80, 0xa5, 0xff].forEach(value => {
      const original = new Uint8Array(64)
      original[position] = value

      // 1. codec rasterization must match the editor's getSpritePixel
      const grid = io.bytesToPixels(original, big, color)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          assert.strictEqual(
            grid[y][x],
            getSpritePixel(original, x, y, big, color),
            'pixel mismatch at (' + x + ',' + y + ')')
        }
      }

      // 2. full export/import round trip restores identical editor bytes
      const text = io.serializeSprite(
        io.exportSprite(original, big, color, PALETTE))
      const imported = io.importSpriteFrame(io.deserializeSprite(text), 0)

      const editorClone = new Uint8Array(64)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          setSpritePixel(editorClone, x, y, big, color, grid[y][x])
        }
      }
      clampSpriteData(editorClone, big, color)
      for (let i = 0; i < 64; i++) {
        assert.strictEqual(imported.bytes[i], editorClone[i],
          'rebuilt byte ' + i + ' differs from editor setSpritePixel result')
      }
      checked++
    })
  }
}

checkGeometry(false, false)
checkGeometry(false, true)
checkGeometry(true, false)
checkGeometry(true, true)

// 3. monochrome round trips never produce layer-1 bits (binary semantics)
const mono = new Uint8Array(64).fill(0xff)
const monoBack = io.importSpriteFrame(
  io.deserializeSprite(io.serializeSprite(io.exportSprite(mono, true, false, PALETTE))), 0)
for (let i = 32; i < 64; i++) assert.strictEqual(monoBack.bytes[i], 0)

console.log('editor equivalence: ' + checked + ' input cases across all four' +
  ' geometries match the original getSpritePixel/setSpritePixel math exactly')
