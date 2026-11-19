const storageKey = "pplnd-package-manager";
const managerPreference = new EventTarget();
let preferredManager: string | null = null;

function restorePreference(): void {
	try {
		preferredManager = localStorage.getItem(storageKey);
	} catch {}
}

restorePreference();
window.addEventListener("pageshow", (event) => {
	if (event.persisted) {
		restorePreference();
		managerPreference.dispatchEvent(new Event("restore"));
	}
});

export class PplndPmTabs extends HTMLElement {
	private abort: AbortController | null = null;
	private copyTimer: number | undefined;

	connectedCallback(): void {
		this.abort?.abort();
		this.abort = new AbortController();
		const { signal } = this.abort;

		const tabs = [...this.querySelectorAll<HTMLButtonElement>("[data-pm]")];
		const code = this.querySelector<HTMLElement>("[data-pm-code]");
		const copyBtn = this.querySelector<HTMLButtonElement>("[data-pm-copy]");
		const [defaultTab] = tabs;
		if (!defaultTab || !code) {
			return;
		}

		let active = defaultTab;
		let arrowCenter: number | undefined;
		const positionArrow = (animate = false): void => {
			const tab = active.getBoundingClientRect();
			if (tab.width === 0) {
				return;
			}
			const box = this.getBoundingClientRect();
			const border = Number.parseFloat(getComputedStyle(this).borderLeftWidth);
			const nextCenter = tab.left + tab.width / 2 - box.left - border;
			if (nextCenter === arrowCenter) {
				return;
			}
			this.classList.toggle("animate-pm-arrow", animate && arrowCenter !== undefined);
			this.style.setProperty("--pm-arrow-center", `${nextCenter}px`);
			arrowCenter = nextCenter;
		};

		const syncSelection = (animate = false): void => {
			active = tabs.find((tab) => tab.dataset.pm === preferredManager) || defaultTab;
			for (const tab of tabs) {
				const selected = tab === active;
				tab.setAttribute("aria-selected", String(selected));
				tab.tabIndex = selected ? 0 : -1;
			}
			const prompt = code.querySelector(".p");
			if (prompt) {
				code.replaceChildren(prompt, document.createTextNode(active.dataset.pmCmd || ""));
			}
			positionArrow(animate);
		};

		const selectManager = (tab: HTMLButtonElement): void => {
			const manager = tab.dataset.pm;
			if (!manager) {
				return;
			}
			preferredManager = manager;
			try {
				localStorage.setItem(storageKey, manager);
			} catch {}
			managerPreference.dispatchEvent(new Event("change"));
		};

		for (const [index, tab] of tabs.entries()) {
			tab.addEventListener("click", () => selectManager(tab), { signal });
			tab.addEventListener("keydown", (event) => {
				let next: number;
				if (event.key === "ArrowRight") {
					next = (index + 1) % tabs.length;
				} else if (event.key === "ArrowLeft") {
					next = (index + tabs.length - 1) % tabs.length;
				} else if (event.key === "Home") {
					next = 0;
				} else if (event.key === "End") {
					next = tabs.length - 1;
				} else {
					return;
				}
				event.preventDefault();
				tabs[next]?.focus();
				if (tabs[next]) {
					selectManager(tabs[next]);
				}
			}, { signal });
		}

		managerPreference.addEventListener("change", () => syncSelection(true), { signal });
		managerPreference.addEventListener("restore", () => syncSelection(), { signal });
		syncSelection();

		const resize = new ResizeObserver(() => positionArrow());
		resize.observe(this);
		for (const tab of tabs) {
			resize.observe(tab);
		}
		window.addEventListener("resize", () => positionArrow(), { signal });
		signal.addEventListener("abort", () => resize.disconnect(), { once: true });

		const copyCommand = async (): Promise<void> => {
			if (!copyBtn) {
				return;
			}
			try {
				await navigator.clipboard.writeText((code.textContent || "").replace(/^\$/u, ""));
				copyBtn.textContent = "Copied";
			} catch {
				copyBtn.textContent = "Failed";
			}
			clearTimeout(this.copyTimer);
			this.copyTimer = window.setTimeout(() => {
				copyBtn.textContent = "Copy";
			}, 1400);
		};

		copyBtn?.addEventListener("click", () => {
			void copyCommand();
		}, { signal });
	}

	disconnectedCallback(): void {
		this.abort?.abort();
		this.abort = null;
		clearTimeout(this.copyTimer);
	}
}
