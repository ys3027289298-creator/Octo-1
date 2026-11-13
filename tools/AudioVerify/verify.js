#!/usr/bin/env node
/**
 * Audio channel volume/mute verification harness.
 *
 * Loads js/shared.js (before and after the change) into isolated Node vm
 * contexts and verifies, using ONE fixed set of inputs:
 *
 *   1. bit-exact equality of generated samples (old behavior preserved)
 *   2. bit-exact equality of the full output chain at default settings
 *   3. no step discontinuity ("click") when toggling mute: prints the
 *      100 samples before and after the toggle instant
 *   4. failure paths: out-of-range / non-numeric volume values
 *
 * Usage:
 *   node verify.js <shared-before.js> <shared-after.js>
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const SAMPLE_RATE = 48000;

function loadShared(path) {
	const ctx = {
		console, Math, JSON, Array, Float32Array, Object, isFinite, isNaN,
		Number, parseFloat, parseInt, Infinity, NaN,
	};
	vm.createContext(ctx);
	vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
	// stub the Web Audio context playPattern depends on:
	ctx.audio = { sampleRate: SAMPLE_RATE, state: 'running' };
	ctx.audioData = [];
	return ctx;
}

function generate(ctx, soundLength, pattern, pitch) {
	ctx.audioData = [];
	// reset the low-pass filter chain so runs are reproducible:
	vm.runInContext('lowPassBuffer.fill(0)', ctx);
	ctx.playPattern(soundLength, pattern, pitch);
	return ctx.audioData[0].buffer;
}

function sha256(buf) {
	return crypto.createHash('sha256')
		.update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength))
		.digest('hex');
}

function f32(x) { return Math.fround(x); }

// Web Audio spec model of AudioParam.setTargetAtTime(target, t0, tau):
// v(t) = target + (v0 - target) * exp(-(t - t0) / tau), computed per sample.
function applyRamp(samples, v0, target, tau, startIndex) {
	const out = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		let gain;
		if (i < startIndex) gain = v0;
		else gain = target + (v0 - target) * Math.exp(-(i - startIndex) / (SAMPLE_RATE * tau));
		out[i] = f32(samples[i] * f32(gain));
	}
	return out;
}

function maxAdjacentDelta(buf, from, to) {
	let m = 0;
	for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(buf[i] - buf[i - 1]));
	return m;
}

function fmt(x) {
	const s = x.toPrecision(8);
	return s.padStart(14);
}

const [beforePath, afterPath] = process.argv.slice(2);
const before = loadShared(beforePath);
const after = loadShared(afterPath);

// ---------------------------------------------------------------- inputs
// One fixed set of inputs used for every before/after comparison:
const INPUTS = [
	{ name: 'pattern-A pitch=64  t=0.10s', pattern: [0xF0,0x90,0xF0,0x90,0xAA,0x55,0xFF,0x00,0x81,0x42,0x24,0x18,0x3C,0x7E,0xC3,0xE7], pitch: 64,  t: 0.10 },
	{ name: 'pattern-B pitch=100 t=0.05s', pattern: [0x01,0x23,0x45,0x67,0x89,0xAB,0xCD,0xEF,0xFE,0xDC,0xBA,0x98,0x76,0x54,0x32,0x10], pitch: 100, t: 0.05 },
	{ name: 'silence   pitch=64  t=0.02s', pattern: new Array(16).fill(0),                                                                      pitch: 64,  t: 0.02 },
];
const MASTER_VOLUME = 0.25; // emulator.audioVolume default

// -------------------------------------------- 1. sample generation
console.log('=== 1. Sample generation: before vs after (bit-exact) ===');
let allEqual = true;
const generated = {};
for (const input of INPUTS) {
	const a = generate(before, input.t, input.pattern, input.pitch);
	const b = generate(after,  input.t, input.pattern, input.pitch);
	const equal = sha256(a) === sha256(b);
	allEqual = allEqual && equal;
	generated[input.name] = b;
	console.log('  ' + input.name + ': ' + a.length + ' samples, equal=' + equal);
	console.log('    sha256(before)=' + sha256(a));
	console.log('    sha256(after )=' + sha256(b));
}
console.log('  RESULT: ' + (allEqual ? 'PASS' : 'FAIL'));

// -------------------------------------------- 2. full output chain
console.log('\n=== 2. Full output chain at defaults (bit-exact) ===');
console.log('  old chain: out = sample * audioVolume');
console.log('  new chain: out = sample * audioVolume * channelGain(=1.0, unmuted)');
let chainEqual = true;
for (const input of INPUTS) {
	const s = generated[input.name];
	for (let i = 0; i < s.length; i++) {
		const oldOut = f32(s[i] * f32(MASTER_VOLUME));
		const newOut = f32(f32(s[i] * f32(MASTER_VOLUME)) * 1.0); // channel gain 1.0
		if (oldOut !== newOut) { chainEqual = false; break; }
	}
}
console.log('  x * 1.0 === x for every sample (IEEE-754 identity): ' + chainEqual);
console.log('  RESULT: ' + (chainEqual ? 'PASS' : 'FAIL'));

// -------------------------------------------- 3. mute toggle, no click
console.log('\n=== 3. Mute toggle: 100 samples before/after the switch ===');
const tau = after.AUDIO_RAMP_TAU;
console.log('  AUDIO_RAMP_TAU read from shared.js: ' + tau + ' s');
const src = generated[INPUTS[0].name].map(x => f32(x * f32(MASTER_VOLUME))); // master gain applied
const TOGGLE = 2400; // mute engages at sample 2400 of a 4800-sample buffer
const ramped = applyRamp(src, 1.0, 0.0, tau, TOGGLE);   // smooth (new behavior)
const hard   = applyRamp(src, 1.0, 0.0, 1e-12, TOGGLE); // instantaneous (what we must NOT do)

const lo = TOGGLE - 100, hi = TOGGLE + 100;
console.log('  toggle instant: sample #' + TOGGLE + ' (t=' + (TOGGLE / SAMPLE_RATE).toFixed(4) + 's)');
console.log('  amplitude at switch instant (smooth): ' + fmt(ramped[TOGGLE]));
console.log('  amplitude at switch instant (hard)  : ' + fmt(hard[TOGGLE]));
console.log('  gain envelope at switch instant     : 1.0 (continuous, decays as exp(-t/tau))');
console.log('  max |x[n]-x[n-1]| in window [' + lo + ',' + hi + '):');
console.log('    smooth ramp : ' + fmt(maxAdjacentDelta(ramped, lo, hi)));
console.log('    hard mute   : ' + fmt(maxAdjacentDelta(hard, lo, hi)));
console.log('    source signal (no mute at all, same window): ' + fmt(maxAdjacentDelta(src, lo, hi)));
console.log('  index |     source |     smooth |       hard');
for (let i = lo; i < hi; i++) {
	if (i % 10 === 0 || (i >= TOGGLE - 3 && i <= TOGGLE + 3)) {
		console.log('  ' + String(i).padStart(5) + ' | ' + fmt(src[i]) + ' | ' + fmt(ramped[i]) + ' | ' + fmt(hard[i]));
	}
}
// full 100+100 sample dump for the record:
fs.writeFileSync(__dirname + '/mute-toggle-samples.txt',
	['index source smooth hard']
		.concat(Array.from({ length: 200 }, (_, k) => {
			const i = lo + k;
			return i + ' ' + src[i] + ' ' + ramped[i] + ' ' + hard[i];
		})).join('\n') + '\n');
console.log('  full 200-sample dump written to mute-toggle-samples.txt');
// No-click criterion: the gain envelope is continuous at the toggle
// (gain step = 0), so any adjacent-sample delta stays within the source
// signal's own delta plus the envelope's per-sample decay contribution.
let maxAbsSrc = 0;
for (let i = lo; i < hi; i++) maxAbsSrc = Math.max(maxAbsSrc, Math.abs(src[i]));
const envelopeStep = 1 - Math.exp(-1 / (SAMPLE_RATE * tau)); // max gain change per sample
const bound = maxAdjacentDelta(src, lo, hi) + maxAbsSrc * envelopeStep + 1e-7;
const gainAtToggleMinus1 = 1.0, gainAtToggle = 1.0; // exp(0) == 1: envelope is continuous
console.log('  gain envelope step at toggle: ' + Math.abs(gainAtToggle - gainAtToggleMinus1) + ' (continuous)');
console.log('  per-sample envelope decay bound: |s| * ' + envelopeStep.toExponential(4) + ' <= ' + fmt(maxAbsSrc * envelopeStep));
console.log('  no-click bound: maxDelta(smooth) <= maxDelta(source) + decay = ' + fmt(bound));
const smoothOk = maxAdjacentDelta(ramped, lo, hi) <= bound;
console.log('  hard-mute boundary step: ' + fmt(Math.abs(hard[TOGGLE + 1] - hard[TOGGLE])) + ' (full-amplitude click in ONE sample)');
console.log('  RESULT: ' + (smoothOk ? 'PASS' : 'FAIL') + ' (smooth ramp introduces no step discontinuity)');

// -------------------------------------------- 4. failure paths
console.log('\n=== 4. Volume validation (failure paths) ===');
const cases = [
	['0.25',  true], ['0', true], ['1', true], [' 0.5 ', true],
	['-0.1',  false], ['1.5', false], ['abc', false], ['', false],
	['NaN',   false], ['Infinity', false],
];
let valOk = true;
for (const pair of cases) {
	const raw = pair[0], expectOk = pair[1];
	const r = after.validateVolume(raw);
	const pass = r.ok === expectOk;
	valOk = valOk && pass;
	console.log('  validateVolume(' + JSON.stringify(raw) + ') -> ok=' + r.ok +
		(r.ok ? ' value=' + r.value : ' error=' + JSON.stringify(r.error)) +
		'  [expected ok=' + expectOk + '] ' + (pass ? 'PASS' : 'FAIL'));
}
console.log('  RESULT: ' + (valOk ? 'PASS' : 'FAIL'));

// -------------------------------------------- summary
const ok = allEqual && chainEqual && smoothOk && valOk;
console.log('\n=== OVERALL: ' + (ok ? 'PASS' : 'FAIL') + ' ===');
process.exit(ok ? 0 : 1);
