/**
* Jasmine spec for the sprite import/export codec. Runs in both the browser
* SpecRunner.html and the headless Node runner (tests/jasmine-node-runner.js).
**/

(function() {
  const PALETTE = {
    backgroundColor: '#996600',
    fillColor:       '#ffcc00',
    fillColor2:      '#ff6600',
    blendColor:      '#662200',
  }

  function bytes(seed, size) {
    const out = new Uint8Array(64)
    let state = seed
    for (let i = 0; i < size; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      out[i] = state & 0xff
    }
    return out
  }

  function expectThrowContaining(block, fragment) {
    let thrown = null
    try { block() }
    catch (error) { thrown = error }
    expect(thrown).toBeTruthy()
    expect(String(thrown.message)).toContain(fragment)
  }

  describe('sprite import/export round trips', () => {
    ;[
      { big: false, color: false, size: 15 },
      { big: false, color: true,  size: 30 },
      { big: true,  color: false, size: 32 },
      { big: true,  color: true,  size: 60 },
    ].forEach(geometry => {
      it('is byte-identical for ' + geometry.size + '-byte geometry', () => {
        const original = bytes(geometry.size + 5, geometry.size)
        const text = serializeSprite(
          exportSprite(original, geometry.big, geometry.color, PALETTE))
        const imported = importSpriteFrame(deserializeSprite(text), 0)
        for (let i = 0; i < geometry.size; i++) {
          expect(imported.bytes[i]).toEqual(original[i])
        }
        for (let i = geometry.size; i < 64; i++) {
          expect(imported.bytes[i]).toEqual(0)
        }
      })
    })

    it('keeps every palette index (including transparent 0) pixel-identical', () => {
      const grid = []
      for (let y = 0; y < 15; y++) {
        const row = []
        for (let x = 0; x < 8; x++) row.push((x + y) % 4)
        grid.push(row)
      }
      const encoded = pixelsToBytes(grid, false, true)
      const text = serializeSprite(exportSprite(encoded, false, true, PALETTE))
      const restored = bytesToPixels(
        importSpriteFrame(deserializeSprite(text), 0).bytes, false, true)
      expect(restored).toEqual(grid)
    })

    it('round trips a multi-frame atlas with matching indices', () => {
      const frames = [bytes(1, 60), bytes(2, 60), bytes(3, 60)]
      const text = serializeSprite(exportSpriteAtlas(frames, true, true, PALETTE))
      const atlas = importSpriteAtlas(deserializeSprite(text))
      expect(atlas.frames.length).toEqual(3)
      frames.forEach((original, index) => {
        for (let i = 0; i < 60; i++) {
          expect(atlas.frames[index][i]).toEqual(original[i])
        }
      })
    })

    it('rejects out-of-range and malformed frame numbers', () => {
      const doc = deserializeSprite(
        serializeSprite(exportSprite(bytes(9, 15), false, false, PALETTE)))
      expectThrowContaining(() => importSpriteFrame(doc, 1), 'invalid frame number: 1')
      expectThrowContaining(() => importSpriteFrame(doc, -1), 'invalid frame number: -1')
      expectThrowContaining(() => importSpriteFrame(doc, 2.5), 'invalid frame number')
      expectThrowContaining(() => importSpriteFrame(doc, '0'), 'invalid frame number')
    })

    it('rejects malformed documents and bad palettes', () => {
      expectThrowContaining(() => deserializeSprite('nope'), 'unable to parse')
      const badPalette = Object.assign({}, PALETTE, { fillColor: 'red' })
      expectThrowContaining(
        () => exportSprite(new Uint8Array(64), false, false, badPalette), '#RRGGBB')
      expectThrowContaining(
        () => exportSpriteAtlas([], false, false, PALETTE), 'at least one frame')
    })
  })
})()
