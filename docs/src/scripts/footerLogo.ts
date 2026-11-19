type Point2D = { readonly x: number; readonly y: number; };

type EdgeSegment = {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	readonly nx: number;
	readonly ny: number;
};

const LOGO_WIDTH = 467.7;
const LOGO_HEIGHT = 306.36;
const HALF_WIDTH = LOGO_WIDTH / 2;
const HALF_HEIGHT = LOGO_HEIGHT / 2;
const HALF_DEPTH = 17;
const CAMERA_Z = 1050;
const CANVAS_BLEED = 1.44;
const CURVE_STEPS = 12;
const INTRO_DELAY_MS = 1000;
const INTRO_DURATION_MS = 2200;

const LOGO_PATH_DATA =
	"M396.16,42.43C352.54,15.07,294.9,0,233.85,0c-41.34,0-81.91,7.05-117.34,20.38-34.03,12.81-62.7,31.17-82.93,53.09C11.61,97.29,0,124.84,0,153.17c0,24.88,9.09,49.49,26.28,71.18,15.84,19.99,38.77,37.72,66.32,51.29,40.8,20.1,89.64,30.72,141.25,30.72,61.05,0,118.69-15.07,162.31-42.43,46.14-28.95,71.54-68.27,71.54-110.74s-25.41-81.8-71.54-110.74ZM364.37,152.88c-24.58,13.8-57.63,21.4-93.07,21.4s-68.49-7.6-93.07-21.4c-21.42-12.03-33.22-26.91-33.22-41.91s11.8-29.88,33.22-41.91c24.58-13.8,57.63-21.4,93.07-21.4s68.49,7.6,93.07,21.4c21.42,12.03,33.22,26.91,33.22,41.91s-11.8,29.88-33.22,41.91ZM139.99,252.93h0v-58.14c0-5.02,2.48-9.36,6.82-11.89,4.32-2.52,9.5-2.54,13.87-.07l.54.31c29.69,16.67,68.78,25.85,110.08,25.85s80.39-9.18,110.08-25.85c25.01-14.04,41.46-32.26,47.89-52.55,2.48,7.41,3.72,14.96,3.72,22.58,0,30.09-19.63,58.97-55.27,81.33-38.17,23.94-89.25,37.12-143.86,37.12-31.69,0-61.78-4.31-89.52-12.81-2.59-.8-4.35-3.19-4.35-5.89ZM59.11,97.02c9.87-10.7,22.25-20.36,36.91-28.8,4.12-2.37,9.25.57,9.25,5.31v159.28c0,4.74-5.13,7.7-9.23,5.33-17.58-10.16-32.15-22.23-42.54-35.35h0c-12.45-15.71-18.77-32.41-18.77-49.61,0-19.44,8.43-38.87,24.39-56.16Z";

function sampleCubic(
	ring: Point2D[],
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	x3: number,
	y3: number,
): void {
	for (let step = 1; step <= CURVE_STEPS; step++) {
		const t = step / CURVE_STEPS;
		const mt = 1 - t;
		const mt2 = mt * mt;
		const t2 = t * t;
		ring.push({
			x: mt2 * mt * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t2 * t * x3 - HALF_WIDTH,
			y: mt2 * mt * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t2 * t * y3 - HALF_HEIGHT,
		});
	}
}

function parseLogoGeometry(
	pathData: string,
): { readonly rings: readonly (readonly Point2D[])[]; readonly edges: readonly EdgeSegment[]; } {
	const tokens = pathData.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gu) ?? [];
	const rawRings: Point2D[][] = [];
	let currentRing: Point2D[] = [];
	let idx = 0;
	let command = "";
	let curX = 0;
	let curY = 0;
	let subX = 0;
	let subY = 0;
	let lastCpX = 0;
	let lastCpY = 0;
	let prevCmd = "";

	const nextNum = (): number => Number(tokens[idx++]);
	const isCommand = (token: string | undefined): boolean => Boolean(token && /^[A-Za-z]$/u.test(token));
	const pushPoint = (x: number, y: number): void => {
		const centeredX = x - HALF_WIDTH;
		const centeredY = y - HALF_HEIGHT;
		const prev = currentRing[currentRing.length - 1];
		if (!prev || Math.hypot(centeredX - prev.x, centeredY - prev.y) > 1e-4) {
			currentRing.push({ x: centeredX, y: centeredY });
		}
	};

	while (idx < tokens.length) {
		if (isCommand(tokens[idx])) {
			command = tokens[idx++] as string;
		}
		switch (command) {
			case "M":
			case "m": {
				const rel = command === "m";
				curX = (rel ? curX : 0) + nextNum();
				curY = (rel ? curY : 0) + nextNum();
				subX = curX;
				subY = curY;
				currentRing = [];
				rawRings.push(currentRing);
				pushPoint(curX, curY);
				command = rel ? "l" : "L";
				prevCmd = "M";
				break;
			}
			case "L":
			case "l": {
				const rel = command === "l";
				curX = (rel ? curX : 0) + nextNum();
				curY = (rel ? curY : 0) + nextNum();
				pushPoint(curX, curY);
				prevCmd = command;
				break;
			}
			case "H":
			case "h": {
				const rel = command === "h";
				curX = (rel ? curX : 0) + nextNum();
				pushPoint(curX, curY);
				prevCmd = command;
				break;
			}
			case "V":
			case "v": {
				const rel = command === "v";
				curY = (rel ? curY : 0) + nextNum();
				pushPoint(curX, curY);
				prevCmd = command;
				break;
			}
			case "C":
			case "c": {
				const rel = command === "c";
				const bx = rel ? curX : 0;
				const by = rel ? curY : 0;
				const x1 = bx + nextNum();
				const y1 = by + nextNum();
				const x2 = bx + nextNum();
				const y2 = by + nextNum();
				const x3 = bx + nextNum();
				const y3 = by + nextNum();
				sampleCubic(currentRing, curX, curY, x1, y1, x2, y2, x3, y3);
				curX = x3;
				curY = y3;
				lastCpX = x2;
				lastCpY = y2;
				prevCmd = command;
				break;
			}
			case "S":
			case "s": {
				const rel = command === "s";
				const bx = rel ? curX : 0;
				const by = rel ? curY : 0;
				const isCubicPrev = prevCmd === "C" || prevCmd === "c" || prevCmd === "S" || prevCmd === "s";
				const x1 = isCubicPrev ? 2 * curX - lastCpX : curX;
				const y1 = isCubicPrev ? 2 * curY - lastCpY : curY;
				const x2 = bx + nextNum();
				const y2 = by + nextNum();
				const x3 = bx + nextNum();
				const y3 = by + nextNum();
				sampleCubic(currentRing, curX, curY, x1, y1, x2, y2, x3, y3);
				curX = x3;
				curY = y3;
				lastCpX = x2;
				lastCpY = y2;
				prevCmd = command;
				break;
			}
			case "Z":
			case "z": {
				curX = subX;
				curY = subY;
				prevCmd = "Z";
				command = "";
				break;
			}
			default: {
				idx++;
				break;
			}
		}
	}

	const rings = rawRings.map((ring) => {
		if (ring.length > 1) {
			const [first] = ring;
			const last = ring[ring.length - 1];
			if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
				ring.pop();
			}
		}
		return ring;
	}).filter((ring) => ring.length >= 3);

	const areas = rings.map((ring) => {
		let sum = 0;
		for (let i = 0; i < ring.length; i++) {
			const a = ring[i];
			const b = ring[(i + 1) % ring.length];
			sum += a.x * b.y - b.x * a.y;
		}
		return sum;
	});

	let outerIndex = 0;
	for (let i = 1; i < areas.length; i++) {
		if (Math.abs(areas[i]) > Math.abs(areas[outerIndex])) {
			outerIndex = i;
		}
	}

	const edges: EdgeSegment[] = [];
	for (let r = 0; r < rings.length; r++) {
		const ring = rings[r];
		const wantOutward = r === outerIndex;
		// Outer rim walls face outward; inner cutout walls face into the hollow interior.
		const normalSign = (areas[r] >= 0 ? 1 : -1) * (wantOutward ? 1 : -1);
		for (let i = 0; i < ring.length; i++) {
			const p0 = ring[i];
			const p1 = ring[(i + 1) % ring.length];
			const dx = p1.x - p0.x;
			const dy = p1.y - p0.y;
			const len = Math.hypot(dx, dy);
			if (len < 1e-4) {
				continue;
			}
			edges.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, nx: normalSign * (dy / len), ny: normalSign * (-dx / len) });
		}
	}

	return { rings, edges };
}

export function initFooterLogo(): void {
	const foot = document.querySelector<HTMLElement>(".foot");
	const link = foot?.querySelector<HTMLAnchorElement>(".brand-home");
	const mark = link?.querySelector<HTMLElement>("[data-logo-wrap]");
	const canvas = mark?.querySelector<HTMLCanvasElement>(".brand-canvas");
	const ctx = canvas?.getContext("2d");
	if (!foot || !link || !mark || !canvas || !ctx) {
		return;
	}

	const { rings, edges } = parseLogoGeometry(LOGO_PATH_DATA);
	const motionQuery = matchMedia("(prefers-reduced-motion: no-preference)");
	let isVisible = false;
	let listening = false;
	let hasInteracted = false;
	let hasPlayedIntro = false;
	let introTimer: number | null = null;
	let introRaf: number | null = null;
	let drawRaf: number | null = null;
	let colorRaf: number | null = null;
	let transitionRaf: number | null = null;
	let thetaDeg = 0;
	let cssWidth = 0;
	let cssHeight = 0;
	let dpr = Math.min(window.devicePixelRatio || 1, 3);
	let inkColor = "#111";

	const syncColors = (): void => {
		inkColor = getComputedStyle(link).color || "#111";
	};

	const renderFrame = (): void => {
		if (!motionQuery.matches || cssWidth <= 0 || cssHeight <= 0) {
			return;
		}
		const w = canvas.width;
		const h = canvas.height;
		if (w <= 0 || h <= 0) {
			return;
		}

		ctx.clearRect(0, 0, w, h);

		// Non-Euclidean half-turn wrap: maps [0, 360] onto [-90, 90), holding continuous spin
		// direction while keeping both sides right-way-round across edge-on 90° and 270°.
		const wrappedDeg = ((((thetaDeg + 90) % 180) + 180) % 180) - 90;
		const phi = (wrappedDeg * Math.PI) / 180;
		const cosPhi = Math.cos(phi);
		const sinPhi = Math.sin(phi);
		const cx = w / 2;
		const cy = h / 2;
		const baseScale = (w / CANVAS_BLEED) / LOGO_WIDTH;

		ctx.fillStyle = inkColor;
		ctx.strokeStyle = inkColor;
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(0.75, 0.75 * dpr);

		for (let i = 0; i < edges.length; i++) {
			const edge = edges[i];
			const rnx = edge.nx * cosPhi;
			const rny = edge.ny;
			const rnz = -edge.nx * sinPhi;

			const midX = (edge.x0 + edge.x1) * 0.5;
			const midY = (edge.y0 + edge.y1) * 0.5;
			const rmx = midX * cosPhi;
			const rmz = -midX * sinPhi;

			const facing = rnx * -rmx + rny * -midY + rnz * (CAMERA_Z - rmz);
			if (facing <= 0) {
				continue;
			}

			const rx0 = edge.x0 * cosPhi;
			const rz0Base = -edge.x0 * sinPhi;
			const rx1 = edge.x1 * cosPhi;
			const rz1Base = -edge.x1 * sinPhi;

			const fz0 = rz0Base + HALF_DEPTH * cosPhi;
			const fz1 = rz1Base + HALF_DEPTH * cosPhi;
			const bz0 = rz0Base - HALF_DEPTH * cosPhi;
			const bz1 = rz1Base - HALF_DEPTH * cosPhi;

			const fp0 = (CAMERA_Z / (CAMERA_Z - fz0)) * baseScale;
			const fp1 = (CAMERA_Z / (CAMERA_Z - fz1)) * baseScale;
			const bp0 = (CAMERA_Z / (CAMERA_Z - bz0)) * baseScale;
			const bp1 = (CAMERA_Z / (CAMERA_Z - bz1)) * baseScale;

			ctx.beginPath();
			ctx.moveTo(cx + (rx0 + HALF_DEPTH * sinPhi) * fp0, cy + edge.y0 * fp0);
			ctx.lineTo(cx + (rx1 + HALF_DEPTH * sinPhi) * fp1, cy + edge.y1 * fp1);
			ctx.lineTo(cx + (rx1 - HALF_DEPTH * sinPhi) * bp1, cy + edge.y1 * bp1);
			ctx.lineTo(cx + (rx0 - HALF_DEPTH * sinPhi) * bp0, cy + edge.y0 * bp0);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		}

		// Skip the near face only within the <1deg sliver where the camera crosses behind z = +HALF_DEPTH.
		if (cosPhi > HALF_DEPTH / CAMERA_Z) {
			const zOffsetX = HALF_DEPTH * sinPhi;
			const zOffsetZ = HALF_DEPTH * cosPhi;
			ctx.beginPath();
			for (let r = 0; r < rings.length; r++) {
				const ring = rings[r];
				for (let i = 0; i < ring.length; i++) {
					const pt = ring[i];
					const rz = -pt.x * sinPhi + zOffsetZ;
					const scale = (CAMERA_Z / (CAMERA_Z - rz)) * baseScale;
					const px = cx + (pt.x * cosPhi + zOffsetX) * scale;
					const py = cy + pt.y * scale;
					if (i === 0) {
						ctx.moveTo(px, py);
					} else {
						ctx.lineTo(px, py);
					}
				}
				ctx.closePath();
			}
			ctx.fill("evenodd");
		}
	};

	const scheduleDraw = (): void => {
		if (drawRaf === null) {
			drawRaf = requestAnimationFrame(() => {
				drawRaf = null;
				renderFrame();
			});
		}
	};

	const stopIntro = (): void => {
		if (introTimer !== null) {
			window.clearTimeout(introTimer);
			introTimer = null;
		}
		if (introRaf !== null) {
			cancelAnimationFrame(introRaf);
			introRaf = null;
		}
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (event.pointerType === "touch") {
			return;
		}
		const width = window.innerWidth;
		if (width <= 0) {
			return;
		}
		hasInteracted = true;
		stopIntro();
		const progress = Math.min(1, Math.max(0, event.clientX / width));
		thetaDeg = progress * 360;
		scheduleDraw();
	};

	const attach = (): void => {
		if (!listening && motionQuery.matches) {
			window.addEventListener("pointermove", onPointerMove, { passive: true });
			listening = true;
		}
	};

	const stopColorTransition = (): void => {
		if (transitionRaf !== null) {
			cancelAnimationFrame(transitionRaf);
			transitionRaf = null;
		}
	};

	const stepColorTransition = (): void => {
		if (!motionQuery.matches) {
			transitionRaf = null;
			return;
		}
		syncColors();
		renderFrame();
		transitionRaf = requestAnimationFrame(stepColorTransition);
	};

	const detach = (): void => {
		if (listening) {
			window.removeEventListener("pointermove", onPointerMove);
			listening = false;
		}
		stopIntro();
		stopColorTransition();
		if (drawRaf !== null) {
			cancelAnimationFrame(drawRaf);
			drawRaf = null;
		}
		if (colorRaf !== null) {
			cancelAnimationFrame(colorRaf);
			colorRaf = null;
		}
	};

	const scheduleIntro = (): void => {
		if (!motionQuery.matches || hasInteracted || hasPlayedIntro || introTimer !== null) {
			return;
		}
		introTimer = window.setTimeout(() => {
			introTimer = null;
			if (!isVisible || !motionQuery.matches || hasInteracted) {
				return;
			}
			hasPlayedIntro = true;
			const startTime = performance.now();
			const stepIntro = (now: number): void => {
				if (!isVisible || !motionQuery.matches || hasInteracted) {
					introRaf = null;
					return;
				}
				const elapsed = Math.min(1, (now - startTime) / INTRO_DURATION_MS);
				const eased = elapsed < 0.5 ? 4 * elapsed * elapsed * elapsed : 1 - ((-2 * elapsed + 2) ** 3) / 2;
				thetaDeg = eased * 360;
				renderFrame();
				if (elapsed < 1) {
					introRaf = requestAnimationFrame(stepIntro);
				} else {
					introRaf = null;
					thetaDeg = 0;
				}
			};
			introRaf = requestAnimationFrame(stepIntro);
		}, INTRO_DELAY_MS);
	};

	const syncSize = (): void => {
		const rect = canvas.getBoundingClientRect();
		dpr = Math.min(window.devicePixelRatio || 1, 3);
		cssWidth = rect.width;
		cssHeight = rect.height;
		if (cssWidth > 0 && cssHeight > 0) {
			const nextW = Math.max(1, Math.round(cssWidth * dpr));
			const nextH = Math.max(1, Math.round(cssHeight * dpr));
			if (canvas.width !== nextW || canvas.height !== nextH) {
				canvas.width = nextW;
				canvas.height = nextH;
			}
		}
	};

	const refreshPalette = (): void => {
		if (colorRaf !== null) {
			cancelAnimationFrame(colorRaf);
		}
		colorRaf = requestAnimationFrame(() => {
			colorRaf = null;
			syncColors();
			renderFrame();
		});
	};

	const activate = (): void => {
		mark.dataset.logoReady = "";
		syncColors();
		syncSize();
		renderFrame();
	};

	const deactivate = (): void => {
		detach();
		delete mark.dataset.logoReady;
		thetaDeg = 0;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	};

	if (motionQuery.matches) {
		activate();
	}

	new ResizeObserver(() => {
		if (!motionQuery.matches) {
			return;
		}
		syncSize();
		renderFrame();
	}).observe(canvas);

	new IntersectionObserver(([entry]) => {
		isVisible = Boolean(entry?.isIntersecting);
		if (isVisible && motionQuery.matches) {
			attach();
			scheduleIntro();
		} else {
			detach();
		}
	}).observe(foot);

	new MutationObserver(refreshPalette).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});

	for (const eventName of ["pointerenter", "pointerleave", "focus", "blur"] as const) {
		link.addEventListener(eventName, refreshPalette);
	}

	link.addEventListener("transitionrun", (event) => {
		if (event.target === link && event.propertyName === "color" && motionQuery.matches && transitionRaf === null) {
			transitionRaf = requestAnimationFrame(stepColorTransition);
		}
	});

	for (const eventName of ["transitionend", "transitioncancel"] as const) {
		link.addEventListener(eventName, (event) => {
			if (event.target === link && event.propertyName === "color") {
				stopColorTransition();
				syncColors();
				renderFrame();
			}
		});
	}

	motionQuery.addEventListener("change", () => {
		if (motionQuery.matches) {
			activate();
			if (isVisible) {
				attach();
			}
		} else {
			deactivate();
		}
	});
}
