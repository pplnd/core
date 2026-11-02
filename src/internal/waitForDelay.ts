export const waitForDelay = (duration: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		// The abort callback and timer callback share this handle.
		// oxlint-disable-next-line prefer-const
		let timer: ReturnType<typeof setTimeout>;
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, duration);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
