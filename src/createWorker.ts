export interface SharedWorkerOptions extends WorkerOptions {
	sameSiteCookies?: "all" | "none";
}

export const createWorkerWithDataUrl = (
	f: () => void,
	options?: WorkerOptions,
) => new Worker(functionToDataUrl(f), options);

export const createSharedWorkerWithDataUrl = (
	f: () => void,
	options?: SharedWorkerOptions,
) => new SharedWorker(functionToDataUrl(f), options);

export const createWorkerWithBlob = (
	f: () => void,
	options?: WorkerOptions,
) => {
	const url = functionToObjectUrl(f);
	const w = new Worker(url, options);
	URL.revokeObjectURL(url);
	return w;
};

export const createSharedWorkerWithBlob = (
	f: () => void,
	options?: SharedWorkerOptions,
) => {
	const url = functionToObjectUrl(f);
	const w = new SharedWorker(url, options);
	URL.revokeObjectURL(url);
	return w;
};

export const functionToDataUrl = (f: () => void) =>
	`data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(`(${f.toString()})()`)))}`;

export const functionToObjectUrl = (f: () => void) =>
	URL.createObjectURL(
		new Blob([`(${f.toString()})()`], { type: "text/javascript" }),
	);

export const createWorker = (f: () => void, options?: WorkerOptions) => {
	try {
		return createWorkerWithDataUrl(f, options);
	} catch (e) {
		return createWorkerWithBlob(f, options);
	}
};

export const createSharedWorker = (
	f: () => void,
	options?: SharedWorkerOptions,
) => {
	try {
		return createSharedWorkerWithDataUrl(f, options);
	} catch (e) {
		return createSharedWorkerWithBlob(f, options);
	}
};
