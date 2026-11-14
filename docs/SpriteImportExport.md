# Sprite Import/Export

The Sprite Editor can exchange sprites with external art tools through a
self-describing, lossless container called **octosprite**. Files use the
`.octosprite.json` extension and are plain UTF-8 JSON, so they can be
generated or inspected by any toolchain without a special library.

## UI workflow

The Sprite Editor panel gains four controls:

- **Export Frame** writes the sprite currently shown in the editor as a
  single-frame document.
- **Add To Atlas** appends the current sprite to a buffered multi-frame
  atlas. All buffered frames must share the same size and color mode.
- **Export Atlas** writes the buffered frames as one multi-frame document.
- **Import...** loads an `.octosprite.json` file. The frame number box then
  selects which frame is shown; changing the number reloads that frame.

Importing restores the editor byte array, the 8x15/16x16 and monochrome/
color flags, and the four palette colors. Status and validation errors are
shown inline next to the frame number box, and an invalid frame number is
rejected without changing the editor.

## Document format

```json
{
  "format": "octosprite",
  "version": 1,
  "geometry": { "width": 16, "height": 16, "big": true, "color": true },
  "palette": {
    "backgroundColor": "#996600",
    "fillColor":       "#ffcc00",
    "fillColor2":      "#ff6600",
    "blendColor":      "#662200"
  },
  "frameCount": 2,
  "frames": [
    { "pixels": [[3, 1, 2, 0], "... rows of palette indices ..."] }
  ]
}
```

- `format` must be `"octosprite"` and `version` must be `1`; anything else
  is rejected on import.
- `geometry` names the Chip-8 sprite shape: `8x15` or `16x16`, and whether
  the second bit plane (color) is present.
- `palette` always lists all four slots as explicit `#RRGGBB` colors. The
  index-to-slot mapping is fixed and documented in the file itself:
  `0 = backgroundColor`, `1 = fillColor`, `2 = fillColor2`,
  `3 = blendColor`.
- Each pixel is stored as its **palette index**, never as a color value, so
  external tools can remap colors without touching the pixel data.

## Pixel and transparency semantics

The palette index of every pixel is preserved exactly:

- Index `0` is the background/transparent layer. It is stored explicitly
  like every other index and round-trips verbatim.
- Indices are the two Chip-8 bit planes combined as
  `index = plane0 + 2 * plane1`. Index `3` is the XO-Chip blend of both
  planes. Monochrome sprites only ever contain indices `0` and `1`, and
  import guarantees their second plane stays all-zero.
- Re-import rebuilds the editor's exact byte layout, so the sprite editor's
  existing hex/save representation is byte-for-byte identical after a round
  trip. No existing save format, cartridge, or `.8o`/`.ch8` path changes.

## Error handling

Import and frame selection throw descriptive errors for: frame numbers
outside `0..frameCount-1`, non-integer or non-numeric frame numbers,
malformed JSON, unknown `format`/`version`, geometry mismatches, palette
entries that are not `#RRGGBB`, pixels outside `0..3`, wrong grid
dimensions, and empty frame lists. See `tests/failure-paths.js` for the
reproducible catalog.

## Resource bounds

Sprite geometry is fixed-size, so bounds are simple:

- Editor storage per frame is always a 64-byte `Uint8Array` regardless of
  geometry (only the active 15/30/32/60 bytes carry data; the rest is zero).
- Serialized size is bounded by `340 + 3 * width * height * frameCount`
  bytes (measured worst case: ~143 KB for 256 16x16 color frames).
- A document holds at most 65535 frames; larger requests are rejected.
- Peak working memory is linear in frame count; measured numbers and the
  checks that enforce these bounds live in `tests/resource-bounds.js`.

## Automated verification

All commands run from the repository root with Node.js:

```
node tests/sprite-io.test.js          # 20 codec round-trip and error tests
node tests/sprite-equivalence.test.js # 846 cases vs. original editor math
node tests/before-after.js            # before/after comparison, writes JSON
node tests/failure-paths.js           # reproducible failure catalog
node tests/resource-bounds.js         # size/memory bounds and frame cap
node tests/jasmine-node-runner.js     # original Jasmine suite + new specs
node tests/tool-sprite.smoke.js       # browser UI handler smoke test
```

The codec itself lives in `js/sprite-io.js`, which has no DOM dependencies;
the browser glue is the import/export section of `js/tool-sprite.js`.
