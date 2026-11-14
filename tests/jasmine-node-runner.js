#!/usr/bin/env node
"use strict"

/**
* Headless runner for the repository's Jasmine specs.
*
* The project ships a browser-only SpecRunner.html; this harness loads the
* same vendored Jasmine core and the same source/spec files in the same
* order, but inside a Node VM with a minimal DOM/canvas stub. It exists so
* the existing test suite (the old-behavior baseline) can be exercised in
* CI without a browser. No application code is stubbed.
**/

const fs   = require('fs')
const path = require('path')
const vm   = require('vm')

const root = path.join(__dirname, '..')

function makeCanvas2D() {
  // Minimal subset of the CanvasRenderingContext2D surface used by
  // shared.js setTransform()/renderDisplay() and the existing specs.
  let matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  // The editor composes rotation + translation imperatively; accumulate the
  // same affine operations a browser would, so getTransform() reports the
  // exact matrix the specs assert on.
  return {
    fillStyle: '#000000',
    fillRect() {},
    scale(sx, sy) {
      matrix = {
        a: matrix.a * sx, b: matrix.b * sx, c: matrix.c * sy, d: matrix.d * sy,
        e: matrix.e, f: matrix.f,
      }
    },
    save() {},
    restore() {},
    translate(tx, ty) {
      matrix.e += matrix.a * tx + matrix.c * ty
      matrix.f += matrix.b * tx + matrix.d * ty
    },
    rotate(theta) {
      const cos = Math.cos(theta)
      const sin = Math.sin(theta)
      matrix = {
        a: matrix.a * cos + matrix.c * sin,
        b: matrix.b * cos + matrix.d * sin,
        c: matrix.a * -sin + matrix.c * cos,
        d: matrix.b * -sin + matrix.d * cos,
        e: matrix.e,
        f: matrix.f,
      }
    },
    setTransform(a, b, c, d, e, f) { matrix = { a, b, c, d, e, f } },
    getTransform() { return Object.assign({}, matrix) },
  }
}

function makeElement(tagName) {
  const listeners = {}
  const element = {
    tagName: (tagName || 'div').toUpperCase(),
    style: {},
    dataset: {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false },
    },
    children: [],
    innerHTML: '',
    textContent: '',
    value: '',
    files: [],
    last: undefined,
    width: 0,
    height: 0,
    appendChild(child) { this.children.push(child); return child },
    removeChild(child) {
      this.children = this.children.filter(x => x !== child)
      return child
    },
    prepend() {},
    querySelector() { return makeElement('span') },
    querySelectorAll() { return [] },
    addEventListener(type, handler) { listeners[type] = handler },
    removeEventListener() {},
    click() {},
    getContext() { return makeCanvas2D() },
    getBoundingClientRect() { return { left: 0, top: 0 } },
    refresh() {},
    setValue() {},
    getValue() { return '0' },
    on() {},
  }
  return element
}

const body = makeElement('body')
const elementRegistry = {}
function findById(node, id) {
  if (node.id === id) return node
  for (const child of node.children || []) {
    const hit = findById(child, id)
    if (hit) return hit
  }
  return null
}
const documentStub = {
  body,
  createElement: tagName => makeElement(tagName),
  createTextNode: text => ({ text: text }),
  getElementById: id => {
    const attached = findById(body, id)
    if (attached) return attached
    if (!elementRegistry[id]) elementRegistry[id] = makeElement('div')
    return elementRegistry[id]
  },
  querySelector: () => makeElement('a'),
  querySelectorAll: () => [],
  addEventListener() {},
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
  Uint8Array, Uint16Array, Int8Array, ArrayBuffer, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  btoa: text => Buffer.from(text, 'binary').toString('base64'),
  atob: text => Buffer.from(text, 'base64').toString('binary'),
  localStorage: (function() {
    const store = {}
    return {
      getItem: key => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value) },
      removeItem: key => { delete store[key] },
    }
  })(),
  document: documentStub,
  navigator: { userAgent: 'node' },
  window: null,
  XMLHttpRequest: function() {
    this.open = () => {}
    this.send = () => {}
  },
  FileReader: function() {
    this.readAsText = () => {}
    this.readAsArrayBuffer = () => {}
  },
  Blob: function() {},
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
vm.createContext(sandbox)

function load(relativePath) {
  const file = path.join(root, relativePath)
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: relativePath })
}

// Vendored Jasmine core (same file the browser SpecRunner uses).
load('jasmine/lib/jasmine-3.5.0/jasmine.js')

// Jasmine's browser boot assumes window/jasmineRequire globals; replicate
// the environment/interface setup without jasmine-html.
vm.runInContext(`
  var jasmine = jasmineRequire.core(jasmineRequire);
  var env = jasmine.getEnv();
  var jasmineInterface = jasmineRequire.interface(jasmine, env);
  Object.keys(jasmineInterface).forEach(k => { this[k] = jasmineInterface[k]; });
  var failures = [];
  var passed = 0;
  var reporter = {
    jasmineStarted() {},
    specDone(result) {
      if (result.status === 'passed') { passed++; }
      else {
        failures.push(result.fullName + ' [' + result.status + ']' +
          result.failedExpectations.map(e => '\\n    ' + e.message).join(''));
      }
    },
    jasmineDone() {
      this.jasmineResults = { passed: passed, failures: failures };
    },
  };
  env.addReporter(reporter);
`, sandbox)

// Same source order as jasmine/SpecRunner.html, plus the new sprite module.
;[
  'js/emulator.js',
  'js/compiler.js',
  'js/decompiler.js',
  'js/shared.js',
  'js/util.js',
  'js/sprite-io.js',
  'js/sharing.js',
  'js/input.js',
  'js/debugger.js',
  'js/recording.js',
].forEach(load)

// Existing specs first (old behavior), then the sprite-io spec.
;[
  'jasmine/spec/shared.spec.js',
  'jasmine/spec/sharing.spec.js',
  'tests/sprite-io.jasmine.spec.js',
].forEach(load)

vm.runInContext('env.execute();', sandbox)

// env.execute() is asynchronous; flush microtasks/timers and then read results.
setTimeout(() => {
  const results = vm.runInContext('reporter.jasmineResults', sandbox)
  console.log('jasmine: ' + results.passed + ' passed, ' + results.failures.length + ' failed')
  results.failures.forEach(failure => console.error('  FAIL - ' + failure))
  process.exitCode = results.failures.length ? 1 : 0
}, 200)
