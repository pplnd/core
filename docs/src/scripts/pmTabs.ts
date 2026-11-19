export class PplndPmTabs extends HTMLElement {
	private abort: AbortController | null = null;
	private copyTimer: number | undefined;

	connectedCallback(): void {
		this.abort?.abort();
		this.abort = new AbortController();
		const { signal } = this.abort;

		const tabs = [...this.querySelectorAll<HTMLButtonElement>("[data-pm-cmd]")];
		const code = this.querySelector<HTMLElement>("[data-pm-code]");
		const copyBtn = this.querySelector<HTMLButtonElement>("[data-pm-copy]");
		if (!tabs.length || !code) {
			return;
		}

		const selectManager = (active: HTMLButtonElement): void => {
			for (const tab of tabs) {
				const selected = tab === active;
				tab.setAttribute("aria-selected", String(selected));
				tab.tabIndex = selected ? 0 : -1;
			}
			const prompt = code.querySelector(".p");
			if (prompt) {
				code.replaceChildren(prompt, document.createTextNode(active.dataset.pmCmd || ""));
			}
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

		selectManager(tabs[0]!);

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
