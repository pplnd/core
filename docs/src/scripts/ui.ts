import type { SearchEntry } from "../nav";
import { initFooterLogo } from "./footerLogo";
import { PplndPmTabs } from "./pmTabs";

function rankEntry(entry: SearchEntry, needle: string): number {
	const label = entry.label.toLowerCase();
	const short = (label.split(".").pop() || label).replace(/\(\)$/u, "");
	if (label === needle) {
		return entry.meta ? 0.5 : 0;
	}
	if (short === needle) {
		return 1;
	}
	if (label.startsWith(needle)) {
		return 2;
	}
	if (label.split(".").some((part) => part.startsWith(needle))) {
		return 3;
	}
	if (label.includes(needle)) {
		return 4;
	}
	if ((entry.meta || entry.section).toLowerCase().includes(needle)) {
		return 5;
	}
	return 6;
}

function isPrimaryClick(event: MouseEvent): boolean {
	return (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey
		&& !event.altKey);
}

class PplndSearch extends HTMLElement {
	private abort: AbortController | null = null;
	private entries: readonly SearchEntry[] = [];
	private fullIndexPromise: Promise<void> | null = null;
	private dialog: HTMLDialogElement | null = null;
	private input: HTMLInputElement | null = null;
	private clearBtn: HTMLButtonElement | null = null;
	private countEl: HTMLElement | null = null;
	private resultsEl: HTMLUListElement | null = null;
	private noResultsEl: HTMLElement | null = null;
	private itemTpl: HTMLTemplateElement | null = null;

	get isOpen(): boolean {
		return Boolean(this.dialog?.open);
	}

	connectedCallback(): void {
		this.abort?.abort();
		this.abort = new AbortController();
		const { signal } = this.abort;

		this.dialog = this.querySelector<HTMLDialogElement>(".search-dialog");
		this.input = this.querySelector<HTMLInputElement>("#module-query");
		this.clearBtn = this.querySelector<HTMLButtonElement>("#search-clear");
		this.countEl = this.querySelector<HTMLElement>("#search-count");
		this.resultsEl = this.querySelector<HTMLUListElement>(".search-results");
		this.noResultsEl = this.querySelector<HTMLElement>(".no-results");
		this.itemTpl = this.querySelector<HTMLTemplateElement>("[data-search-item-tpl]");

		const rawIndex = this.querySelector("#search-index")?.textContent
			|| document.querySelector("#search-index")?.textContent || "[]";
		try {
			this.entries = JSON.parse(rawIndex) as SearchEntry[];
		} catch {
			this.entries = [];
		}

		this.input?.addEventListener("input", () => this.filterModules(), { signal });
		this.querySelector(".search-form")?.addEventListener("submit", (event) => event.preventDefault(), { signal });
		this.clearBtn?.addEventListener("click", (event) => {
			event.preventDefault();
			if (!this.input) {
				return;
			}
			this.input.value = "";
			this.filterModules();
			this.input.focus();
		}, { signal });
		this.dialog?.addEventListener("close", () => this.syncSearchUrl(false), { signal });
		this.resultsEl?.addEventListener("click", (event) => {
			if (!isPrimaryClick(event)) {
				return;
			}
			const link = event.target instanceof Element ? event.target.closest("a.search-item") : null;
			if (link && this.dialog?.open) {
				this.dialog.close();
			}
		}, { signal });

		const initialParams = new URLSearchParams(location.search);
		if (initialParams.has("search")) {
			this.open(initialParams.get("search") || "");
		}
	}

	disconnectedCallback(): void {
		this.abort?.abort();
		this.abort = null;
	}

	open(initialQuery = ""): void {
		if (!this.dialog || !this.input) {
			return;
		}
		this.input.value = initialQuery;
		if (!this.dialog.open) {
			this.dialog.showModal();
		}
		void this.loadFullSearchIndex();
		this.filterModules();
		this.input.focus();
	}

	private loadFullSearchIndex(): Promise<void> {
		if (this.fullIndexPromise) {
			return this.fullIndexPromise;
		}
		this.fullIndexPromise = fetch("/search-index.json").then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
			.then((items) => {
				if (Array.isArray(items) && items.length) {
					this.entries = items as SearchEntry[];
					this.filterModules();
				}
			}).catch(() => {});
		return this.fullIndexPromise;
	}

	private syncSearchUrl(open: boolean): void {
		if (!this.input) {
			return;
		}
		const url = new URL(location.href);
		if (open) {
			url.searchParams.set("search", this.input.value.trim());
		} else {
			url.searchParams.delete("search");
		}
		const qs = url.searchParams.toString();
		history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
	}

	private createResultNode(entry: SearchEntry): Node {
		if (this.itemTpl) {
			const fragment = this.itemTpl.content.cloneNode(true) as DocumentFragment;
			const link = fragment.querySelector<HTMLAnchorElement>("a.search-item");
			const meta = fragment.querySelector<HTMLElement>(".search-item-meta");
			const title = fragment.querySelector<HTMLElement>(".search-item-title");
			if (link) {
				link.href = entry.href;
			}
			if (meta) {
				meta.textContent = entry.meta || entry.section;
			}
			if (title) {
				title.textContent = entry.label;
			}
			return fragment;
		}
		const item = document.createElement("li");
		const link = document.createElement("a");
		link.className = "search-item";
		link.href = entry.href;
		const meta = document.createElement("span");
		meta.className = "search-item-meta";
		meta.textContent = entry.meta || entry.section;
		const title = document.createElement("span");
		title.className = "search-item-title";
		title.textContent = entry.label;
		link.append(meta, title);
		item.append(link);
		return item;
	}

	private filterModules(): void {
		if (!this.dialog || !this.input || !this.resultsEl || !this.noResultsEl) {
			return;
		}
		const needle = this.input.value.trim().toLowerCase();
		const matches = this.entries.filter((entry) =>
			!needle
			|| entry.label.toLowerCase().includes(needle)
			|| entry.section.toLowerCase().includes(needle)
			|| (entry.meta && entry.meta.toLowerCase().includes(needle))
			|| (entry.desc && entry.desc.toLowerCase().includes(needle))
		);
		if (needle) {
			matches.sort((a, b) => rankEntry(a, needle) - rankEntry(b, needle));
		}
		const visible = matches.slice(0, 240);
		this.resultsEl.replaceChildren(...visible.map((entry) => this.createResultNode(entry)));
		if (this.clearBtn) {
			this.clearBtn.hidden = this.input.value.length === 0;
		}
		if (this.countEl) {
			this.countEl.textContent = matches.length > 240
				? `Results: ${matches.length} (showing 240)`
				: `Results: ${matches.length}`;
		}
		this.noResultsEl.hidden = matches.length !== 0;
		if (this.dialog.open) {
			this.syncSearchUrl(true);
		}
	}
}

function initShell(): void {
	const searchEl = document.querySelector<PplndSearch>("pplnd-search");
	for (const trigger of document.querySelectorAll<HTMLButtonElement>(".search")) {
		trigger.addEventListener("click", () => searchEl?.open(""));
	}

	const menu = document.querySelector<HTMLButtonElement>(".menu-toggle");
	function setMenu(open: boolean): void {
		if (!menu) {
			return;
		}
		document.body.classList.toggle("menu-open", open);
		menu.setAttribute("aria-expanded", String(open));
		menu.textContent = open ? "Close" : "Menu";
	}
	if (menu) {
		menu.addEventListener("click", () => setMenu(menu.getAttribute("aria-expanded") === "false"));
		matchMedia("(min-width: 768px)").addEventListener("change", () => setMenu(false));
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && !searchEl?.isOpen && document.body.classList.contains("menu-open")) {
				setMenu(false);
				menu.focus();
			}
		});
	}

	for (const trigger of document.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
		trigger.addEventListener("click", () => {
			const open = trigger.getAttribute("aria-expanded") === "false";
			const panel = document.getElementById(trigger.dataset.panel || "");
			if (panel) {
				panel.inert = !open;
			}
			trigger.setAttribute("aria-expanded", String(open));
		});
	}

	const themeBtn = document.querySelector<HTMLButtonElement>("#theme");
	let themeSwitchRaf: number | null = null;
	let themeSwitchRaf2: number | null = null;
	function syncThemeLabel(): void {
		if (!themeBtn) {
			return;
		}
		const isDark = document.documentElement.dataset.theme === "dark";
		themeBtn.textContent = `Dark mode: ${isDark ? "On" : "Off"}`;
		themeBtn.setAttribute("aria-pressed", String(isDark));
	}
	syncThemeLabel();
	themeBtn?.addEventListener("click", () => {
		const root = document.documentElement;
		if (themeSwitchRaf !== null) {
			cancelAnimationFrame(themeSwitchRaf);
			themeSwitchRaf = null;
		}
		if (themeSwitchRaf2 !== null) {
			cancelAnimationFrame(themeSwitchRaf2);
			themeSwitchRaf2 = null;
		}
		root.classList.add("theme-switching");
		root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
		syncThemeLabel();
		themeSwitchRaf = requestAnimationFrame(() => {
			themeSwitchRaf = null;
			themeSwitchRaf2 = requestAnimationFrame(() => {
				themeSwitchRaf2 = null;
				root.classList.remove("theme-switching");
			});
		});
		try {
			localStorage.setItem("pplnd-theme", root.dataset.theme);
		} catch {}
	});

	const leftSticky = document.querySelector<HTMLElement>(".left-sticky");
	const leftNav = document.querySelector<HTMLElement>(".left nav");
	const heroBrand = document.querySelector<HTMLElement>(".hero-brand");
	const goUpWrap = document.querySelector<HTMLElement>(".go-up-wrap");
	const goUpBtn = document.querySelector<HTMLButtonElement>(".go-up");

	if (leftSticky && leftNav && goUpWrap && goUpBtn) {
		const setStuck = (stuck: boolean): void => {
			leftSticky.classList.toggle("is-stuck", stuck);
			goUpWrap.inert = !stuck;
		};
		new IntersectionObserver(([entry]) => {
			if (entry) {
				setStuck(!entry.isIntersecting && entry.boundingClientRect.bottom <= 16);
			}
		}, { rootMargin: "-16px 0px 0px 0px" }).observe(leftNav);

		goUpWrap.addEventListener("focusout", (event) => {
			if (goUpWrap.inert && !event.relatedTarget) {
				const fallback = heroBrand?.querySelector<HTMLElement>("a") || document.querySelector<HTMLElement>(".head button");
				fallback?.focus({ preventScroll: true });
			}
		});

		goUpBtn.addEventListener("click", () => {
			const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
			window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
		});
	}

	const notFoundPath = document.querySelector<SVGTextElement>("#not-found-path");
	const notFoundSearchBtn = document.querySelector<HTMLButtonElement>("#not-found-search-btn");
	const notFoundSearchTitle = document.querySelector<HTMLElement>("#not-found-search-title");
	if (notFoundPath || notFoundSearchBtn) {
		const rawPath = location.pathname;
		if (notFoundPath) {
			notFoundPath.textContent = rawPath.length > 34 ? `${rawPath.slice(0, 31)}...` : rawPath;
		}
		const slug = (rawPath.split("/").filter(Boolean).pop() || "").replace(/[-_]+/gu, " ").trim();
		if (slug && notFoundSearchTitle) {
			const secondary = document.createElement("span");
			secondary.textContent = " Open search pre-filled with this route segment.";
			notFoundSearchTitle.replaceChildren(document.createTextNode(`Search for "${slug}".`), secondary);
		}
		notFoundSearchBtn?.addEventListener("click", () => searchEl?.open(slug));
	}

	initFooterLogo();
}

if (!customElements.get("pplnd-pm-tabs")) {
	customElements.define("pplnd-pm-tabs", PplndPmTabs);
}
if (!customElements.get("pplnd-search")) {
	customElements.define("pplnd-search", PplndSearch);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initShell, { once: true });
} else {
	initShell();
}
