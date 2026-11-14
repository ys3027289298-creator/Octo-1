/**
* Sprite editor:
**/

const SPRITE_SCALE  = 20
const spriteDraw    = document.getElementById('sprite-draw')
const sprite16      = toggleButton(document.getElementById('sprite-16'), 0, changeSpriteSize)
const spriteColor   = toggleButton(document.getElementById('sprite-color'), 0, updateSpriteEditor)
const spriteClear   = document.getElementById('sprite-clear')
const spritePalette = radioBar(document.getElementById('sprite-palette'), 1, x => {})
const spriteEditor  = textBox(document.getElementById('sprite-editor'), false, '')

spriteClear.onclick = _ => {
  spritePixels = []
  spriteFrames = []
  importedSpriteDoc = null
  spriteFrameBox.value = '0'
  refreshFrameBox()
  reportSpriteIo('', false)
  updateSpriteEditor()
}
function spriteLength() { return (sprite16.getValue() ? 32 : 15) * (spriteColor.getValue() ? 2 : 1) }
function spriteDim(big) { return big ? { rows:16, cols:16 } : { rows:15, cols:8 } }

/**
* Model:
**/

var spritePixels = []

function clampSpriteData() {
  for (var z = spriteLength()+1; z < 64; z++) { spritePixels[z] = 0 }
}
function spritePixel(x,y,wide) {
  const index = wide ? (y*2)+(x > 7 ? 1:0) : y
  return {
    mask:   128 >> (x % 8),
    layer1: index,
    layer2: index + (wide ? 32 : 15),
  }
}
function getSpritePixel(x,y,wide,color) {
  var t = spritePixel(x,y,wide)
  const c1     = !!(t.mask & spritePixels[t.layer1])
  const c2     = !!(t.mask & spritePixels[t.layer2])
  return c1 + (2 * (c2 & color))
}
function setSpritePixel(x,y,wide,color,p) {
  if (x >= (wide ? 16 :  8)) return
  if (y >= (wide ? 16 : 15)) return
  var t = spritePixel(x,y,wide)
  spritePixels[t.layer1] = (spritePixels[t.layer1] & ~t.mask) | ((-!!(p&1))&t.mask)
  spritePixels[t.layer2] = (spritePixels[t.layer2] & ~t.mask) | ((-!!(p&2))&t.mask)
}

/**
* Shifting and Clipping:
**/

function getSpritePixels(dim, dx, dy) {
  const c = spriteColor.getValue()
  return range(dim.rows).map(row => {
    return range(dim.cols).map(col => {
      return getSpritePixel(mod(col - dx, dim.cols), mod(row - dy, dim.rows), dim.cols == 16, c)
    })
  })
}
function setSpritePixels(dim, pix) {
  const c = spriteColor.getValue()
  range(dim.rows).forEach(row => {
    range(dim.cols).forEach(col => {
      setSpritePixel(col, row, dim.cols == 16, c, (pix[row]||[])[col]||0)
    })
  })
}
function changeSpriteSize(toBig) {
  setSpritePixels(spriteDim(toBig), getSpritePixels(spriteDim(!toBig), 0, 0))
  updateSpriteEditor()
}
function scrollSprite(dx, dy) {
  const dim = spriteDim(sprite16.getValue())
  setSpritePixels(dim, getSpritePixels(dim, dx, dy))
  updateSpriteEditor()
}

/**
* Data binding:
**/

// important: loop-breaker!
// CodeMirror itself does not detect when a modification triggers a revalidation,
// and does not ignore writes that are identical to the current data.
var spriteHandlingRefresh = false

function showHex() {
  if (spriteHandlingRefresh) return
  writeBytes(spriteEditor, spriteLength(), spritePixels)
}

spriteEditor.on('change', _ => {
  if (spriteHandlingRefresh) return
  spriteHandlingRefresh = true
  spritePixels = readBytes(spriteEditor, spriteLength())
  updateSpriteEditor()
  spriteHandlingRefresh = false
})

/**
* Rendering:
**/

function showSprite() {
  const c = spriteColor.getValue()
  const d = spriteDim(sprite16.getValue())
  const g = spriteDraw.getContext('2d')
  g.fillStyle = getColor(0)
  g.fillRect(0, 0, spriteDraw.width, spriteDraw.height)
  range(d.rows).forEach(row => {
    range(d.cols).forEach(col => {
      g.fillStyle = getColor(getSpritePixel(col, row, d.cols == 16, c))
      g.fillRect(col * SPRITE_SCALE, row * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE)
    })
  })
}

/**
* Main:
**/

document.getElementById('sprite-left' ).onclick = _ => scrollSprite(-1, 0)
document.getElementById('sprite-right').onclick = _ => scrollSprite( 1, 0)
document.getElementById('sprite-up'   ).onclick = _ => scrollSprite( 0,-1)
document.getElementById('sprite-down' ).onclick = _ => scrollSprite( 0, 1)

drawOnCanvas(spriteDraw, (x, y, draw) => {
  setSpritePixel(
    Math.floor(x / SPRITE_SCALE),
    Math.floor(y / SPRITE_SCALE),
    sprite16.getValue(),
    spriteColor.getValue(),
    draw ? spritePalette.getValue() : 0
  )
  updateSpriteEditor()
})

function updateSpriteEditor() {
  document.querySelectorAll('#sprite-palette>span').forEach((x,i) => {
    x.style.backgroundColor = getColor(i)
  })
  if (sprite16.getValue()) {
    spriteDraw.width  = SPRITE_SCALE * 16
    spriteDraw.height = SPRITE_SCALE * 16
  }
  else {
    spriteDraw.width  = SPRITE_SCALE * 8
    spriteDraw.height = SPRITE_SCALE * 15
  }
  if (!spriteColor.getValue()) {
    spritePalette.setValue(1)
  }
  spritePalette.setVisible(spriteColor.getValue())
  spriteEditor.refresh()

  clampSpriteData()
  showHex()
  showSprite()
}

/**
* Sprite Import/Export
*
* The editor itself edits one sprite at a time. To support multi-frame
* atlases without changing the existing editor/save behavior, exported
* frames are collected in `spriteFrames`: exporting a frame appends the
* current editor bytes, and importing an atlas lets the user walk frames
* by number. All heavy lifting (validation, palette, byte layout) lives
* in the DOM-independent sprite-io.js module.
**/

const spriteFileInput = document.getElementById('sprite-fileinput')
const spriteFrameBox  = document.getElementById('sprite-frame-number')
const spriteIoMessage = document.getElementById('sprite-io-msg')

var spriteFrames = []
var importedSpriteDoc = null

function currentPalette() {
  return {
    backgroundColor: emulator.backgroundColor,
    fillColor:       emulator.fillColor,
    fillColor2:      emulator.fillColor2,
    blendColor:      emulator.blendColor,
  }
}
function activeSpriteLength() { return spriteLength() }
function snapshotSprite() {
  clampSpriteData()
  return spritePixels.slice(0, activeSpriteLength())
}
function reportSpriteIo(message, isError) {
  spriteIoMessage.innerText = message
  spriteIoMessage.classList.toggle('error', !!isError)
}
function frameCount() {
  return importedSpriteDoc ? importedSpriteDoc.frames.length : spriteFrames.length
}
function refreshFrameBox() {
  spriteFrameBox.max = String(Math.max(0, frameCount() - 1))
}

document.getElementById('sprite-export-frame').onclick = _ => {
  try {
    const doc = exportSprite(
      spritePixels,
      sprite16.getValue(),
      spriteColor.getValue(),
      currentPalette()
    )
    saveText('sprite-frame.octosprite.json', serializeSprite(doc))
    reportSpriteIo('Exported one ' + doc.geometry.width + 'x' + doc.geometry.height +
      ' frame with palette index 0 (transparent) and bit planes preserved.', false)
  }
  catch (error) {
    reportSpriteIo('Export failed: ' + error.message, true)
  }
}

document.getElementById('sprite-export-atlas').onclick = _ => {
  try {
    if (spriteFrames.length == 0) {
      throw new Error('atlas is empty - use "Add To Atlas" to collect frames first')
    }
    const doc = exportSpriteAtlas(
      spriteFrames,
      sprite16.getValue(),
      spriteColor.getValue(),
      currentPalette()
    )
    saveText('sprite-atlas.octosprite.json', serializeSprite(doc))
    reportSpriteIo('Exported atlas with ' + doc.frameCount + ' frame(s).', false)
    refreshFrameBox()
  }
  catch (error) {
    reportSpriteIo('Atlas export failed: ' + error.message, true)
  }
}

document.getElementById('sprite-atlas-add').onclick = _ => {
  try {
    const candidate = snapshotSprite()
    if (spriteFrames.length > 0) {
      const previous = spriteFrames[spriteFrames.length - 1]
      if (previous.length != candidate.length) {
        throw new Error('all atlas frames must share the same size (8x15 or 16x16) and color mode')
      }
    }
    spriteFrames.push(candidate)
    refreshFrameBox()
    reportSpriteIo('Frame ' + spriteFrames.length + ' added to atlas (' +
      spriteFrames.length + ' frame(s) buffered).', false)
  }
  catch (error) {
    reportSpriteIo(error.message, true)
  }
}

document.getElementById('sprite-import').onclick = _ => spriteFileInput.click()

function loadSpriteDocument(text) {
  importedSpriteDoc = deserializeSprite(text)
  spriteFrames = []
  refreshFrameBox()
  applyImportedFrame(0)
}

function applyImportedFrame(frameNumber) {
  const result = importSpriteFrame(importedSpriteDoc, frameNumber)
  sprite16.setValue(result.big)
  spriteColor.setValue(result.color)
  spritePixels = Array.from(result.bytes)
  clampSpriteData()
  Object.keys(result.palette).forEach(key => { emulator[key] = result.palette[key] })
  saveLocalOptions()
  updateColor()
  updateSpriteEditor()
  reportSpriteIo('Imported frame ' + frameNumber + ' of ' +
    importedSpriteDoc.frames.length + '; palette indices and bit planes restored.', false)
}

spriteFrameBox.onchange = _ => {
  if (!importedSpriteDoc) {
    reportSpriteIo('Import an .octosprite.json file before selecting a frame.', true)
    spriteFrameBox.value = '0'
    return
  }
  const requested = parseInt(spriteFrameBox.value, 10)
  try {
    if (!Number.isInteger(requested) || requested < 0 ||
        requested >= importedSpriteDoc.frames.length) {
      throw new Error('invalid frame number: ' + spriteFrameBox.value +
        ' (valid range is 0..' + (importedSpriteDoc.frames.length - 1) + ')')
    }
    applyImportedFrame(requested)
  }
  catch (error) {
    reportSpriteIo(error.message, true)
  }
}

spriteFileInput.onchange = _ => {
  const file = spriteFileInput.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = _ => {
    try {
      loadSpriteDocument(reader.result)
      spriteFrameBox.value = '0'
    }
    catch (error) {
      reportSpriteIo('Import failed: ' + error.message, true)
    }
    spriteFileInput.value = ''
  }
  reader.readAsText(file)
}
