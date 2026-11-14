"use strict";

////////////////////////////////////
//
//   Fullscreen Display Modes
//
//   Presentation-only scaling of the emulator canvas. The canvas backing
//   store is never resized and the emulator is never touched; modes only
//   change the element's CSS box, and `image-rendering: pixelated` (see
//   index.html) guarantees nearest-neighbor sampling with no interpolated
//   colors. Modes:
//
//   window  - original behavior: no CSS sizing, 1 backing pixel : 1 px
//   integer - largest whole-number scale factor that fits, centered
//   stretch - fills the viewport, independent horizontal/vertical factors
//
////////////////////////////////////

const DISPLAY_MODES = ["window", "integer", "stretch"]

var displayState = {
	mode:      "window",
	listening: false,
}

function displayElements() {
	return {
		cover:  document.getElementById("run-cover"),
		canvas: document.getElementById("target"),
	}
}

function checkDisplayDimensions(availW, availH, baseW, baseH, caller) {
	const dims = [availW, availH, baseW, baseH]
	for (var z = 0; z < dims.length; z++) {
		if (typeof dims[z] !== "number" || !isFinite(dims[z]) || dims[z] < 0) {
			throw new Error(caller + ": dimensions must be positive finite numbers")
		}
	}
	if (baseW <= 0 || baseH <= 0) {
		throw new Error(caller + ": dimensions must be positive finite numbers")
	}
}

// Largest whole-number factor at which baseW x baseH fits in availW x availH.
// A zero-area (not yet laid out) viewport degrades to 1 instead of Infinity.
function displayIntegerScale(availW, availH, baseW, baseH) {
	checkDisplayDimensions(availW, availH, baseW, baseH, "displayIntegerScale")
	if (availW === 0 || availH === 0) { return 1 }
	return Math.max(1, Math.floor(Math.min(availW / baseW, availH / baseH)))
}

// Pure layout math: given a mode, the available area and the canvas backing
// store size, produce the CSS box {width, height, scaleX, scaleY}.
function computeDisplayLayout(mode, availW, availH, baseW, baseH) {
	if (DISPLAY_MODES.indexOf(mode) < 0) {
		throw new Error("computeDisplayLayout: unknown display mode '" + mode + "'")
	}
	checkDisplayDimensions(availW, availH, baseW, baseH, "computeDisplayLayout")
	if (mode === "window" || availW === 0 || availH === 0) {
		return { width: baseW, height: baseH, scaleX: 1, scaleY: 1 }
	}
	if (mode === "integer") {
		const k = displayIntegerScale(availW, availH, baseW, baseH)
		return { width: baseW * k, height: baseH * k, scaleX: k, scaleY: k }
	}
	return { width: availW, height: availH, scaleX: availW / baseW, scaleY: availH / baseH }
}

// Apply the current mode to the DOM. O(1): two style writes, no pixel work.
function layoutDisplay() {
	const el = displayElements()
	if (!el.cover || !el.canvas) { return }
	if (displayState.mode === "window") {
		el.canvas.style.width  = ""
		el.canvas.style.height = ""
		return
	}
	const rect   = el.cover.getBoundingClientRect()
	const layout = computeDisplayLayout(
		displayState.mode, rect.width, rect.height, el.canvas.width, el.canvas.height)
	el.canvas.style.width  = layout.width  + "px"
	el.canvas.style.height = layout.height + "px"
}

function requestNativeFullscreen(cover) {
	try {
		if (cover.requestFullscreen && !document.fullscreenElement) {
			const p = cover.requestFullscreen()
			if (p && p.catch) { p.catch(function() {}) } // fall back to in-viewport layout
		}
	}
	catch (e) { /* native fullscreen refused; in-viewport layout still applies */ }
}

function exitNativeFullscreen() {
	try {
		if (document.fullscreenElement && document.exitFullscreen) {
			const p = document.exitFullscreen()
			if (p && p.catch) { p.catch(function() {}) }
		}
	}
	catch (e) { /* nothing to exit */ }
}

function onDisplayFullscreenChange() {
	if (!document.fullscreenElement && displayState.mode !== "window") {
		resetDisplayMode() // user pressed Esc: restore window mode
	}
	else {
		layoutDisplay()
	}
}

// Persistent listeners, installed exactly once for the page lifetime.
function installDisplayHandlers() {
	if (displayState.listening) { return }
	window.addEventListener("resize",             layoutDisplay)
	window.addEventListener("orientationchange",  layoutDisplay)
	document.addEventListener("fullscreenchange", onDisplayFullscreenChange)
	displayState.listening = true
}

function setDisplayMode(mode) {
	if (DISPLAY_MODES.indexOf(mode) < 0) {
		throw new Error("setDisplayMode: unknown display mode '" + mode + "'")
	}
	displayState.mode = mode
	const el = displayElements()
	if (!el.cover || !el.canvas) { return }
	installDisplayHandlers()
	if (mode === "window") {
		el.cover.classList.remove("display-fullscreen", "display-integer", "display-stretch")
		el.canvas.style.width  = ""
		el.canvas.style.height = ""
		exitNativeFullscreen()
	}
	else {
		el.cover.classList.add("display-fullscreen")
		el.cover.classList.toggle("display-integer", mode === "integer")
		el.cover.classList.toggle("display-stretch", mode === "stretch")
		layoutDisplay()
		requestNativeFullscreen(el.cover)
	}
}

function resetDisplayMode() {
	setDisplayMode("window")
}

// Hotkey/button helpers: 'f' toggles integer fullscreen on/off (from any
// other fullscreen mode it returns to window), 'g' switches to stretch
// (and from stretch back to integer).
function toggleDisplayInteger() {
	setDisplayMode(displayState.mode === "window" ? "integer" : "window")
}

function toggleDisplayStretch() {
	setDisplayMode(displayState.mode === "stretch" ? "integer" : "stretch")
}
