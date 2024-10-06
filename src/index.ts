import { createWorker } from "./createWorker";

// メインスレッド側で利用するインターフェース（）
export type setTimeout = (func: TimerHandler, duration: number, ...args: unknown[]) => TimerId;
export type setInterval = (func: TimerHandler, duration: number, ...args: unknown[]) => TimerId;
export type clearTimeout = (id: TimerId) => void;
export type clearInterval = (id: TimerId) => void;
// 暗黙的なワーカースレッドを終了する
export type terminate = () => void;
// ワーカースレッドを利用したタイマーオブジェクトを明示的に管理したい場合に使う
export type createWorkerTimer = () => WorkerTimer;
// ワーカースレッドを利用したタイマーオブジェクトのインターフェース
export type WorkerTimer = {
	setTimeout: setTimeout;
	setInterval: setInterval;
	clearTimeout: clearTimeout;
	clearInterval: clearInterval;
	terminate: terminate;
};
// setTimeout/setInterval で使うIDは独自のユニークIDを利用する。
type TimerId = number;
// setTimeout/setInterval のコールバック関数
type TimerHandler = (...args: unknown[]) => void;

// メインスレッドとワーカースレッド間で送受信するメッセージの型
type MessageToWorker = SetTimerMessage | ClearTimerMessage;
type MessageFromWorker = InvokeMessage | ClearMessage;
// ワーカーに送信するメッセージの型
type SetTimerMessage = {
	id: TimerId;
	type: "setTimeout" | "setInterval";
	duration: number;
};
type ClearTimerMessage = {
	id: TimerId;
	type: "clearTimeout" | "clearInterval";
};
// ワーカーからメインスレッドに送信するメッセージの型
type InvokeMessage = {
	id: TimerId;
	type: "invoke";
};
type ClearMessage = {
	id: TimerId;
	type: "clear";
};

// デフォルトの暗黙的なWorkerTimerを保持する変数
let defaultWorkerTimer: WorkerTimer | null = null;
// デフォルトの暗黙的なWorkerTimerを取得する
const getWorkerTimer = (): WorkerTimer => {
	if (defaultWorkerTimer == null) {
		defaultWorkerTimer = createWorkerTimer();
	}
	return defaultWorkerTimer;
};
// デフォルトのWorkerTimerを利用してsetIntervalを呼び出す
export const setInterval = (...args: Parameters<setInterval>) => getWorkerTimer().setInterval(...args);
// デフォルトのWorkerTimerを利用してsetTimeoutを呼び出す
export const setTimeout = (...args: Parameters<setTimeout>) => getWorkerTimer().setTimeout(...args);
// デフォルトのWorkerTimerを利用してclearIntervalを呼び出す
export const clearInterval = (...args: Parameters<clearInterval>) => getWorkerTimer().clearInterval(...args);
// デフォルトのWorkerTimerを利用してclearTimeoutを呼び出す
export const clearTimeout = (...args: Parameters<clearTimeout>) => getWorkerTimer().clearTimeout(...args);
// デフォルトのWorkerTimerを利用してterminateを呼び出す
export const terminate = () => getWorkerTimer().terminate();

// WorkerTimerを明示的に作成する（デフォルトのWorkerTimerを利用する場合はこの関数は使わない）
// 以下のようなメッセージのやり取りで実装する
// ・メイン側で setTimeout/setInterval を実行すると TimerID と共にワーカーに SetTimerMessage メッセージを送信する
// ・ワーカー側で SetTimerMessage メッセージを受信すると setTimeout/setInterval を実行し、そのタイマーIDをメイン側で生成された TimerId と紐づけておく
// ・ワーカー側で setTimeout/setInterval のコールバックが発火するとそれを InvokeMessage メッセージとしてメイン側に送信する
// ・メイン側では InvokeMessage メッセージを受信すると TimerId に紐づけておいた対応する TimerHandler を実行する
// ・clearTimeout/clearInterval でも同様にワーカーに ClearTimerMessage メッセージを送信してタイマーを削除する
export const createWorkerTimer = (): WorkerTimer => {
	// メインスレッド側で保持するデータ
	type TimerTransaction = {
		id: TimerId;
		type: "setTimeout" | "setInterval";
		func: TimerHandler;
		duration: number;
		args: unknown[];
	};
	// setTimeout/setInterval で使うIDは独自のユニークIDを利用する。
	const idMap: Map<TimerId, TimerTransaction> = new Map();
	// ユニークなタイマーIDを生成する関数
	const nextId = (() => {
		let seq = 0;
		return () => seq++;
	})();
	// ワーカースレッドを作成する
	const worker = createWorker(timerWorker, { type: "module" });
	// ワーカーからは invoke メッセージが来くるのでidMapからTimerHandlerを取り出して実行する
	worker.addEventListener(
		"message",
		(message: MessageEvent<MessageFromWorker>) => {
			const { id, type } = message.data;
			const transaction = idMap.get(id);
			if (transaction == null) {
				return;
			}
			if (type === "invoke") {
				transaction.func(...transaction.args);
			} else if (type === "clear") {
				idMap.delete(id);
			}
		},
	);
	// setTimeout/setInterval は同じインターフェースを持つので共通関数にしておく
	const setTimer = (type: "setTimeout" | "setInterval", func: TimerHandler, duration: number, ...args: unknown[]) => {
		const id = nextId();
		idMap.set(id, { id, type, func, duration, args });
		worker.postMessage({ id, type, duration } as SetTimerMessage);
		return id;
	};
	// clearTimeout/clearInterval は同じインターフェースを持つので共通関数にしておく
	const clearTimer = (id: TimerId, type: "clearTimeout" | "clearInterval") => {
		worker.postMessage({ id, type } as ClearTimerMessage);
		idMap.delete(id);
	};
	//
	return {
		setTimeout: (func: TimerHandler, duration: number, ...args: unknown[]) => setTimer("setTimeout", func, duration, ...args),
		setInterval: (func: TimerHandler, duration: number, ...args: unknown[]) => setTimer("setInterval", func, duration, ...args),
		clearTimeout: (id: TimerId) => clearTimer(id, "clearTimeout"),
		clearInterval: (id: TimerId) => clearTimer(id, "clearInterval"),
		terminate: () => worker.terminate(),
	};
};

// timerManagerで動作させるworkerコード
const timerWorker = () => {
	const idMap = new Map<TimerId, number>();
	self.addEventListener("message", (event: MessageEvent<MessageToWorker>) => {
		const { id, type } = event.data;
		if (type === "setTimeout" || type === "setInterval") {
			const setTimer = self[type];
			const invoke = () => self.postMessage({ id, type: "invoke" });
			const callback = type === "setTimeout" ? ()=>{invoke(); idMap.delete(id)} : invoke;
			const nativeId = setTimer(callback, event.data.duration);
			idMap.set(id, nativeId);
		}
		if (type === "clearTimeout" || type === "clearInterval") {
			const clearTimer = self[type];
			clearTimer(idMap.get(id));
			idMap.delete(id);
		}
	});
};
