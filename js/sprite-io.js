/**
* Sprite Import/Export
*
* A self-describing, lossless container ("octosprite") for exchanging
* Chip-8 sprites with external art tools. The format preserves:
*
*   - the exact palette index of every pixel (0..3), including index 0,
*     which is the transparent/background layer;
*   - the Chip-8 two-plane bit semantics (layer 0 and layer 1);
*   - the exact editor byte layout (`spritePixels`), so a round trip
*     reproduces the editor's save format byte-for-byte.
*
* The module intentionally has no DOM dependencies so the same code is
* used by the browser UI and by the Node.js test harness.
**/

(function(root, factory) {
  const api = factory()
  Object.keys(api).forEach(k => { root[k] = api[k] })
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof this !== 'undefined' ? this : (typeof window !== 'undefined' ? window : globalThis), function() {
  "use strict"

  const FORMAT_ID      = 'octosprite'
  const FORMAT_VERSION = 1

  // Palette slots used by Chip-8/XO-Chip rendering.
  const PALETTE_KEYS = [
    'backgroundColor',
    'fillColor',
    'fillColor2',
    'blendColor',
  ]

  /**
  * Geometry and byte layout of an editor sprite.
  * Mirrors tool-sprite.js exactly:
  *   - small sprites are 8 columns x 15 rows, stored in 15 bytes (layer 0)
  *     plus 15 bytes (layer 1, only used by color sprites);
  *   - big sprites are 16 columns x 16 rows, stored as two 16-byte halves
  *     per layer (32 bytes per layer, 64 bytes total).
  **/
  function spriteGeometry(big, color) {
    const cols   = big ? 16 : 8
    const rows   = big ? 16 : 15
    const layers = color ? 2 : 1
    return { cols, rows, layers, bytesPerLayer: big ? 32 : 15 }
  }

  function layerIndex(x, y, layer, big) {
    if (big) return y * 2 + (x > 7 ? 1 : 0) + layer * 32
    return y + layer * 15
  }

  function validateGeometry(big, color) {
    if (typeof big !== 'boolean' || typeof color !== 'boolean') {
      throw new Error('sprite geometry flags must be booleans')
    }
  }

  /**
  * Read one pixel as a palette index (0..3) from editor bytes.
  **/
  function pixelFromBytes(bytes, x, y, big, color) {
    const mask = 128 >> (x % 8)
    const c1 = !!(bytes[layerIndex(x, y, 0, big)] & mask) ? 1 : 0
    const c2 = color && !!(bytes[layerIndex(x, y, 1, big)] & mask) ? 1 : 0
    return c1 + (2 * c2)
  }

  /**
  * Rasterize an editor byte array into a grid of palette indices.
  * Returns an array of `rows` arrays of `cols` indices in 0..3.
  **/
  function bytesToPixels(bytes, big, color) {
    validateGeometry(big, color)
    const g = spriteGeometry(big, color)
    const pixels = []
    for (let y = 0; y < g.rows; y++) {
      const row = []
      for (let x = 0; x < g.cols; x++) {
        row.push(pixelFromBytes(bytes, x, y, big, color))
      }
      pixels.push(row)
    }
    return pixels
  }

  /**
  * Rebuild editor bytes from a grid of palette indices. Only the bytes
  * belonging to the active geometry are written; unused trailing bytes
  * are zeroed, matching the editor's clampSpriteData() behavior.
  **/
  function pixelsToBytes(pixels, big, color) {
    validateGeometry(big, color)
    const g = spriteGeometry(big, color)
    if (!Array.isArray(pixels) || pixels.length !== g.rows) {
      throw new Error('pixel grid must have ' + g.rows + ' rows')
    }
    const bytes = new Uint8Array(64)
    for (let y = 0; y < g.rows; y++) {
      const row = pixels[y]
      if (!Array.isArray(row) || row.length !== g.cols) {
        throw new Error('pixel grid row ' + y + ' must have ' + g.cols + ' columns')
      }
      for (let x = 0; x < g.cols; x++) {
        const value = row[x]
        if (!Number.isInteger(value) || value < 0 || value > 3) {
          throw new Error('pixel (' + x + ',' + y + ') must be a palette index in 0..3')
        }
        const mask = 128 >> (x % 8)
        if (value & 1) bytes[layerIndex(x, y, 0, big)] |= mask
        if (g.layers > 1 && (value & 2)) bytes[layerIndex(x, y, 1, big)] |= mask
      }
    }
    return bytes
  }

  function asHexColor(value, slot) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error('palette slot "' + slot + '" must be a #RRGGBB color, got ' + value)
    }
    return value.toLowerCase()
  }

  function normalizePalette(palette) {
    if (!palette || typeof palette !== 'object') {
      throw new Error('a palette with four #RRGGBB colors is required')
    }
    return PALETTE_KEYS.map(k => asHexColor(palette[k], k))
  }

  function validateFrame(frame, index, g) {
    if (!frame || typeof frame !== 'object' || !Array.isArray(frame.pixels)) {
      throw new Error('frame ' + index + ' must contain a pixels grid')
    }
    if (frame.pixels.length !== g.rows) {
      throw new Error('frame ' + index + ' must have ' + g.rows + ' rows')
    }
    frame.pixels.forEach((row, y) => {
      if (!Array.isArray(row) || row.length !== g.cols) {
        throw new Error('frame ' + index + ' row ' + y + ' must have ' + g.cols + ' columns')
      }
      row.forEach(value => {
        if (!Number.isInteger(value) || value < 0 || value > 3) {
          throw new Error('frame ' + index + ' contains a pixel outside palette indices 0..3')
        }
      })
    })
  }

  /**
  * Build an octosprite document.
  *
  * frames: an array of objects { pixels: number[][] } where each grid is
  *         rows x cols of palette indices in 0..3.
  * options:
  *   big    - 16x16 sprite when true, otherwise 8x15
  *   color  - two-plane color sprite when true, otherwise monochrome
  *   palette- { backgroundColor, fillColor, fillColor2, blendColor }
  **/
  function buildSpriteDocument(frames, options) {
    options = options || {}
    const big   = !!options.big
    const color = !!options.color
    validateGeometry(big, color)
    const g = spriteGeometry(big, color)
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error('at least one frame is required')
    }
    if (frames.length > 65535) {
      throw new Error('a sprite document may contain at most 65535 frames')
    }
    frames.forEach((frame, index) => validateFrame(frame, index, g))
    const palette = normalizePalette(options.palette)
    return {
      format:  FORMAT_ID,
      version: FORMAT_VERSION,
      geometry: { width: g.cols, height: g.rows, big: big, color: color },
      palette: PALETTE_KEYS.reduce((acc, key, index) => {
        acc[key] = palette[index]
        return acc
      }, {}),
      frameCount: frames.length,
      frames: frames.map(frame => ({ pixels: frame.pixels })),
    }
  }

  /**
  * Convenience wrapper: export the editor's current `spritePixels`
  * (a byte array) as a single-frame octosprite document.
  **/
  function exportSprite(bytes, big, color, palette) {
    const pixels = bytesToPixels(bytes, big, color)
    return buildSpriteDocument([{ pixels: pixels }], { big, color, palette })
  }

  /**
  * Export several editor sprites (each a byte array) as a multi-frame
  * atlas document. Every frame must share the same geometry.
  **/
  function exportSpriteAtlas(byteFrames, big, color, palette) {
    if (!Array.isArray(byteFrames) || byteFrames.length === 0) {
      throw new Error('at least one frame is required')
    }
    const frames = byteFrames.map(bytes => ({ pixels: bytesToPixels(bytes, big, color) }))
    return buildSpriteDocument(frames, { big, color, palette })
  }

  function assertDocument(doc) {
    if (!doc || typeof doc !== 'object') {
      throw new Error('not an octosprite document')
    }
    if (doc.format !== FORMAT_ID) {
      throw new Error('unrecognized sprite format: ' + doc.format)
    }
    if (doc.version !== FORMAT_VERSION) {
      throw new Error('unsupported octosprite version: ' + doc.version)
    }
    if (!doc.geometry || typeof doc.geometry.big !== 'boolean' ||
        typeof doc.geometry.color !== 'boolean') {
      throw new Error('document is missing a valid geometry descriptor')
    }
    if (!Array.isArray(doc.frames) || doc.frames.length === 0) {
      throw new Error('document contains no frames')
    }
    if (doc.frameCount !== undefined && doc.frameCount !== doc.frames.length) {
      throw new Error('frameCount does not match the number of frames')
    }
  }

  /**
  * Validate and normalize an octosprite document produced elsewhere.
  * Returns a fresh document with canonicalized palette colors.
  **/
  function parseSpriteDocument(doc) {
    assertDocument(doc)
    const big   = doc.geometry.big
    const color = doc.geometry.color
    const g     = spriteGeometry(big, color)
    if (doc.geometry.width !== g.cols || doc.geometry.height !== g.rows) {
      throw new Error('geometry dimensions do not match the big/color flags')
    }
    const palette = normalizePalette(doc.palette)
    doc.frames.forEach((frame, index) => validateFrame(frame, index, g))
    return {
      format:  FORMAT_ID,
      version: FORMAT_VERSION,
      geometry: { width: g.cols, height: g.rows, big: big, color: color },
      palette: PALETTE_KEYS.reduce((acc, key, index) => {
        acc[key] = palette[index]
        return acc
      }, {}),
      frameCount: doc.frames.length,
      frames: doc.frames.map(frame => ({
        pixels: frame.pixels.map(row => row.slice()),
      })),
    }
  }

  /**
  * Import a single frame from an octosprite document and return the
  * editor byte layout. `frame` is a zero-based frame number; out-of-range
  * or malformed numbers raise an error so callers can surface them.
  **/
  function importSpriteFrame(doc, frame) {
    const parsed = parseSpriteDocument(doc)
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error('invalid frame number: ' + frame + ' (expected an integer >= 0)')
    }
    if (frame >= parsed.frames.length) {
      throw new Error('invalid frame number: ' + frame +
        ' (document has ' + parsed.frames.length + ' frame(s), valid range 0..' +
        (parsed.frames.length - 1) + ')')
    }
    return {
      bytes:   pixelsToBytes(parsed.frames[frame].pixels, parsed.geometry.big, parsed.geometry.color),
      big:     parsed.geometry.big,
      color:   parsed.geometry.color,
      palette: parsed.palette,
    }
  }

  /**
  * Import every frame of an octosprite document as editor byte arrays.
  **/
  function importSpriteAtlas(doc) {
    const parsed = parseSpriteDocument(doc)
    return {
      big:     parsed.geometry.big,
      color:   parsed.geometry.color,
      palette: parsed.palette,
      frames: parsed.frames.map(frame =>
        pixelsToBytes(frame.pixels, parsed.geometry.big, parsed.geometry.color)),
    }
  }

  function serializeSprite(doc) {
    parseSpriteDocument(doc)
    return JSON.stringify(doc)
  }

  function deserializeSprite(text) {
    let doc
    try {
      doc = JSON.parse(text)
    }
    catch (error) {
      throw new Error('unable to parse octosprite JSON: ' + error.message)
    }
    return parseSpriteDocument(doc)
  }

  return {
    SPRITE_FORMAT_ID:      FORMAT_ID,
    SPRITE_FORMAT_VERSION: FORMAT_VERSION,
    SPRITE_PALETTE_KEYS:   PALETTE_KEYS,
    spriteGeometry,
    bytesToPixels,
    pixelsToBytes,
    buildSpriteDocument,
    exportSprite,
    exportSpriteAtlas,
    parseSpriteDocument,
    importSpriteFrame,
    importSpriteAtlas,
    serializeSprite,
    deserializeSprite,
  }
})
