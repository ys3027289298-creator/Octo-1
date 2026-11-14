describe("display modes", () => {

	describe("computeDisplayLayout", () => {
		it("integer mode picks the largest whole-number factor that fits", () => {
			const l = computeDisplayLayout("integer", 1280, 800, 640, 320)
			expect(l.width).toEqual(1280)
			expect(l.height).toEqual(640)
			expect(l.scaleX).toEqual(2)
			expect(l.scaleY).toEqual(2)
		})

		it("integer mode clamps to factor 1 when the viewport is too small", () => {
			const l = computeDisplayLayout("integer", 100, 100, 640, 320)
			expect(l.width).toEqual(640)
			expect(l.height).toEqual(320)
			expect(l.scaleX).toEqual(1)
		})

		it("stretch mode fills the viewport with independent scale factors", () => {
			const l = computeDisplayLayout("stretch", 1280, 800, 640, 320)
			expect(l.width).toEqual(1280)
			expect(l.height).toEqual(800)
			expect(l.scaleX).toEqual(2)
			expect(l.scaleY).toEqual(2.5)
		})

		it("window mode returns the base layout unscaled", () => {
			const l = computeDisplayLayout("window", 1280, 800, 640, 320)
			expect(l).toEqual({ width: 640, height: 320, scaleX: 1, scaleY: 1 })
		})

		it("throws a descriptive Error on invalid dimensions", () => {
			expect(() => computeDisplayLayout("integer", 100, 100, 0, 320))
				.toThrowError(/positive finite numbers/)
			expect(() => computeDisplayLayout("integer", 100, 100, 640, NaN))
				.toThrowError(/positive finite numbers/)
			expect(() => computeDisplayLayout("stretch", Infinity, 100, 640, 320))
				.toThrowError(/positive finite numbers/)
			expect(() => computeDisplayLayout("integer", -5, 100, 640, 320))
				.toThrowError(/positive finite numbers/)
		})

		it("degrades a zero-area viewport to the base layout instead of Infinity/NaN", () => {
			const l = computeDisplayLayout("integer", 0, 0, 640, 320)
			expect(l.width).toEqual(640)
			expect(l.height).toEqual(320)
			expect(isFinite(l.scaleX)).toEqual(true)
			expect(isFinite(l.scaleY)).toEqual(true)
		})
	})

	describe("displayIntegerScale", () => {
		it("rejects NaN, Infinity and negative sizes", () => {
			expect(() => displayIntegerScale(NaN, 800, 640, 320)).toThrow()
			expect(() => displayIntegerScale(1280, Infinity, 640, 320)).toThrow()
			expect(() => displayIntegerScale(1280, -1, 640, 320)).toThrow()
			expect(displayIntegerScale(1280, 800, 640, 320)).toEqual(2)
			expect(displayIntegerScale(0, 0, 640, 320)).toEqual(1)
		})
	})

	describe("setDisplayMode", () => {
		var cover, canvas
		beforeEach(() => {
			cover = document.createElement("div")
			cover.id = "run-cover"
			cover.style.cssText = "position:fixed;top:0;left:0;width:1280px;height:800px;"
			canvas = document.createElement("canvas")
			canvas.id = "target"
			canvas.width = 640
			canvas.height = 320
			cover.appendChild(canvas)
			document.body.appendChild(cover)
		})
		afterEach(() => {
			resetDisplayMode()
			document.body.removeChild(cover)
		})

		it("throws on an unknown mode and leaves state unchanged", () => {
			setDisplayMode("integer")
			expect(() => setDisplayMode("cinema"))
				.toThrowError("setDisplayMode: unknown display mode 'cinema'")
			expect(displayState.mode).toEqual("integer")
		})

		it("applies and removes presentation CSS without touching the backing store", () => {
			setDisplayMode("integer")
			expect(cover.classList.contains("display-fullscreen")).toEqual(true)
			expect(canvas.style.width).toEqual("1280px")
			expect(canvas.style.height).toEqual("640px")
			expect(canvas.width).toEqual(640)
			expect(canvas.height).toEqual(320)
			resetDisplayMode()
			expect(displayState.mode).toEqual("window")
			expect(cover.classList.contains("display-fullscreen")).toEqual(false)
			expect(canvas.style.width).toEqual("")
			expect(canvas.style.height).toEqual("")
		})
	})
})
