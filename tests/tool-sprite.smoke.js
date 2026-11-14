#!/usr/bin/env node
"use strict"

/**
* Browser-context smoke test for the sprite editor UI glue.
* Loads the real index.html script set (sprite-io.js + tool-sprite.js)
* against a hand-rolled DOM and drives the export/import click handlers to
* prove they are wired correctly and surface invalid frame errors.
**/

const fs   = require('fs')
const path = require('path')
const vm   = require('vm')

const root = path.join(__dirname, '..')

function makeElement(id) {
  const handlers = {}
  const element = {
    id: id || '',
    style: {},
    dataset: { value: '0' },
    value: '0',
    files: [],
    innerText: '',
    width: 0,
    height: 0,
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c) },
      remove(c) { this.classes.delete(c) },
      toggle(c, on) { on ? this.classes.add(c) : this.classes.delete(c) },
      contains(c) { return this.classes.has(c) },
    },
    children: [],
    prepend() {},
    appendChild(c) { this.children.push(c) },
    querySelector() { return makeElement('selected-span') },
    querySelectorAll(selector) {
      if (selector === 'span') {
        return [0, 1, 2, 3].map(i => {
          const span = makeElement('palette-span')
          span.dataset = { value: String(i) }
          return span
        })
      }
      return []
    },
    onclick: null,
    onchange: null,
    on() { return this },
    refresh() {},
    setValue(v) { this.value = v },
    getValue() { return this.value },
    setVisible() {},
    addEventListener(type, fn) { handlers[type] = fn },
    click() { if (this.onclick) this.onclick() },
    getContext() {
      return { fillStyle: '', fillRect() {}, getContext() {} }
    },
    getBoundingClientRect() { return { left: 0, top: 0 } },
  }
  return element
}

const registry = {}
function get(id) {
  if (!registry[id]) registry[id] = makeElement(id)
  return registry[id]
}

const savedFiles = []
const documentStub = {
  getElementById: get,
  querySelector: () => ({ click() {}, download: '', href: '' }),
  querySelectorAll: () => [],
  createElement: tag => makeElement(tag),
}

const sandbox = {
  console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String,
  Number, Boolean, Error, RegExp, Uint8Array, Map, Set, parseInt, parseFloat,
  isNaN, btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'binary').toString('base64'),
  document: documentStub,
  window: null,
  navigator: { userAgent: 'node' },
}
sandbox.window = sandbox
vm.createContext(sandbox)

// globals the real page defines elsewhere
vm.runInContext(`
  var emulator = {
    backgroundColor: '#996600', fillColor: '#ffcc00',
    fillColor2: '#ff6600', blendColor: '#662200',
  }
  function getColor(id) { return ['#996600','#ffcc00','#ff6600','#662200'][id] }
  function range(n) { return Array.from({ length: n }, (_, i) => i) }
  function mod(x, y) { x %= y; if (x < 0) x += y; return x }
  function saveLocalOptions() {}
  function updateColor() {}
  function setVisible() {}
  function writeBytes() {}
  function readBytes() { return new Uint8Array(64) }
  function saveText(name, text) { this.__saved = (this.__saved || []); this.__saved.push([name, text]) }
  function drawOnCanvas() {}
  function textBox() {
    return { on() {}, refresh() {}, setValue() {}, getValue() { return '' } }
  }
  function toggleButton() {
    let on = false
    return { getValue: () => on, setValue: v => { on = v } }
  }
  function radioBar(element, initial) {
    let value = initial
    return {
      getValue: () => value,
      setValue: v => { value = v },
      setVisible() {},
    }
  }
  var CodeMirror = () => { throw new Error('CodeMirror should be stubbed') }
  var __readerFile = null
  function FileReader() {
    this.readAsText = function() {
      this.result = __readerFile ? __readerFile.contents : ''
      this.onload && this.onload()
    }
  }
`, sandbox)

function load(relative) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'),
    sandbox, { filename: relative })
}
load('js/sprite-io.js')
load('js/tool-sprite.js')

const result = vm.runInContext(`
  (function() {
    const out = { steps: [] }
    // paint a deterministic color sprite via the exported codec indirectly:
    // place bytes straight into the editor model like the hex box would.
    spritePixels = new Uint8Array(64)
    spritePixels[0] = 0xFF
    spritePixels[15] = 0x0F
    updateSpriteEditor()

    document.getElementById('sprite-export-frame').onclick()
    out.frameExport = window.__saved[0][0]
    const frameDoc = JSON.parse(window.__saved[0][1])
    out.frameDocGeometry = frameDoc.geometry
    out.frameDocPalette = frameDoc.palette

    document.getElementById('sprite-atlas-add').onclick()
    spritePixels[1] = 0x42
    document.getElementById('sprite-atlas-add').onclick()
    document.getElementById('sprite-export-atlas').onclick()
    const atlasDoc = JSON.parse(window.__saved[1][1])
    out.atlasFrames = atlasDoc.frameCount

    // import the atlas back and select a valid then an invalid frame
    const fileInput = document.getElementById('sprite-fileinput')
    const atlasText = window.__saved[1][1]
    fileInput.files = [{ name: 'atlas.octosprite.json', contents: atlasText }]
    __readerFile = fileInput.files[0]
    fileInput.onchange()
    out.importMessage = document.getElementById('sprite-io-msg').innerText

    const box = document.getElementById('sprite-frame-number')
    box.value = '1'
    box.onchange()
    out.validFrameMessage = document.getElementById('sprite-io-msg').innerText
    box.value = '9'
    box.onchange()
    out.invalidFrameMessage = document.getElementById('sprite-io-msg').innerText
    out.errorClass = document.getElementById('sprite-io-msg').classList.contains('error')
    return out
  })()
`, sandbox)

console.log(JSON.stringify(result, null, 2))
const failures = []
if (!result.frameExport.endsWith('.json')) failures.push('frame export filename')
if (result.frameDocGeometry.width !== 8) failures.push('geometry preserved')
if (result.atlasFrames !== 2) failures.push('atlas collected two frames')
if (!/Imported frame 0/.test(result.importMessage)) failures.push('import message: ' + result.importMessage)
if (!/Imported frame 1/.test(result.validFrameMessage)) failures.push('valid frame message')
if (!/invalid frame number: 9/.test(result.invalidFrameMessage)) failures.push('invalid frame error')
if (!result.errorClass) failures.push('error styling flag')

if (failures.length) {
  console.error('SMOKE FAILURES: ' + failures.join('; '))
  process.exit(1)
}
console.log('tool-sprite UI smoke: all handlers behaved as expected')
