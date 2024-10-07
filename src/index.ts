import { createWorker } from './createWorker'

/**
 * setTimeout の型
 * @param {TimerHandler} func - 実行する関数
 * @param {number} [duration=0] - タイムアウトまでの時間（ミリ秒）
 * @param {...unknown} args - 追加の引数
 * @returns {TimerId} タイマーID
 */
type setTimeout = (func: TimerHandler, duration?: number, ...args: unknown[]) => TimerId

/**
 * setInterval の型
 * @param {TimerHandler} func - 実行する関数
 * @param {number} [duration=0] - タイムアウトまでの時間（ミリ秒）
 * @param {...unknown} args - 追加の引数
 * @returns {TimerId} タイマーID
 */
type setInterval = (func: TimerHandler, duration?: number, ...args: unknown[]) => TimerId

/**
 * clearTimeout の型
 * @param {TimerId} id - タイマーID
 */
type clearTimeout = (id: TimerId) => void

/**
 * clearInterval の型
 * @param {TimerId} id - タイマーID
 */
type clearInterval = (id: TimerId) => void

/**
 * terminate の型
 * @returns
 */
type terminate = () => void

/**
 * createWorkerTimer の型
 * @returns {WorkerTimer} ワーカースレッドを利用したタイマーオブジェクト
 */
type createWorkerTimer = () => WorkerTimer

/**
 * ワーカースレッドを利用したタイマーオブジェクトのインターフェース
 */
type WorkerTimer = {
  setTimeout: setTimeout
  setInterval: setInterval
  clearTimeout: clearTimeout
  clearInterval: clearInterval
  terminate: terminate
}

/**
 * setTimeout/setInterval で使うIDは独自のユニークIDを利用する。
 */
type TimerId = number

/**
 * setTimeout/setInterval のコールバック関数
 * @param {...unknown} args - 追加の引数
 */
type TimerHandler = (...args: unknown[]) => void

/**
 * メインスレッドからワーカースレッドに送信するメッセージの型
 */
type MessageToWorker = SetTimerMessage | ClearTimerMessage

/**
 * ワーカースレッドからメインスレッドに送信するメッセージの型
 */
type MessageFromWorker = InvokeMessage

/**
 * setTimeout/setInterval でワーカースレッドに送信するメッセージの型
 */
type SetTimerMessage = {
  id: TimerId
  type: 'setTimeout' | 'setInterval'
  duration: number
}

/**
 * clearTimeout/clearInterval でワーカースレッドに送信するメッセージの型
 */
type ClearTimerMessage = {
  id: TimerId
  type: 'clearTimeout' | 'clearInterval'
}

/**
 * setTimeout/setInterval が発火した際にワーカースレッドからメインスレッドに送信するメッセージの型
 */
type InvokeMessage = {
  id: TimerId
  type: 'invoke'
}

/**
 * デフォルトの暗黙的なWorkerTimerを保持する変数
 */
let defaultWorkerTimer: WorkerTimer | null = null

/**
 * デフォルトのWorkerTimerを取得する
 * @returns {WorkerTimer} デフォルトのWorkerTimer
 */
const getWorkerTimer = (): WorkerTimer => {
  if (defaultWorkerTimer == null) {
    defaultWorkerTimer = createWorkerTimer()
  }
  return defaultWorkerTimer
}

/**
 * デフォルトのWorkerTimerを利用してsetIntervalを呼び出す
 * @param {TimerHandler} func - 実行する関数
 * @param {number} duration - タイムアウトまでの時間（ミリ秒）
 * @param {...unknown} args - 追加の引数
 * @returns {TimerId} タイマーID
 */
export const setInterval = (...args: Parameters<setInterval>) =>
  getWorkerTimer().setInterval(...args)

/**
 * デフォルトのWorkerTimerを利用してsetTimeoutを呼び出す
 * @param {TimerHandler} func - 実行する関数
 * @param {number} duration - タイムアウトまでの時間（ミリ秒）
 * @param {...unknown} args - 追加の引数
 * @returns {TimerId} タイマーID
 */
export const setTimeout = (...args: Parameters<setTimeout>) => getWorkerTimer().setTimeout(...args)

/**
 * デフォルトのWorkerTimerを利用してclearIntervalを呼び出す
 * @param {TimerId} id - タイマーID
 */
export const clearInterval = (...args: Parameters<clearInterval>) =>
  getWorkerTimer().clearInterval(...args)

/**
 * デフォルトのWorkerTimerを利用してclearTimeoutを呼び出す
 * @param {TimerId} id - タイマーID
 */
export const clearTimeout = (...args: Parameters<clearTimeout>) =>
  getWorkerTimer().clearTimeout(...args)

/**
 * デフォルトのWorkerTimerを終了する
 * @returns
 */
export const terminate = () => getWorkerTimer().terminate()

/**
 * WorkerTimerを明示的に作成する
 * デフォルトのWorkerTimerを利用する場合はこの関数は使わない
 *
 * @description
 * 以下のようなメッセージのやり取りで実装する:
 * - メイン側で setTimeout/setInterval を実行すると TimerID と共にワーカーに SetTimerMessage を送信する
 * - ワーカー側で SetTimerMessage を受信すると setTimeout/setInterval を実行し、そのタイマーIDをメイン側で生成された TimerId と紐づけておく
 * - ワーカー側で setTimeout/setInterval のコールバックが発火するとそれを InvokeMessage としてメイン側に送信する
 * - メイン側では InvokeMessage を受信すると TimerId に紐づけておいた対応する TimerHandler を実行する
 * - clearTimeout/clearInterval でも同様にワーカーに ClearTimerMessage を送信してタイマーを削除する
 *
 * @returns {WorkerTimer} 作成されたWorkerTimerインスタンス
 */
export const createWorkerTimer = (): WorkerTimer => {
  // メインスレッド側で保持するデータ
  type TimerTransaction = {
    id: TimerId
    type: 'setTimeout' | 'setInterval'
    func: TimerHandler
    duration: number
    args: unknown[]
  }
  // setTimeout/setInterval で使うIDは独自のユニークIDを利用する。
  const idMap: Map<TimerId, TimerTransaction> = new Map()
  // ユニークなタイマーIDを生成する関数
  const nextId = (() => {
    let seq = 0
    return () => seq++
  })()
  // ワーカースレッドを作成する
  const worker = createWorker(_timerWorker, { type: 'module' })
  // ワーカーからは invoke メッセージが来くるのでidMapからTimerHandlerを取り出して実行する
  worker.addEventListener('message', (message: MessageEvent<MessageFromWorker>) => {
    const { id, type } = message.data
    const transaction = idMap.get(id)
    if (transaction == null) {
      return
    }
    if (type === 'invoke') {
      transaction.func(...transaction.args)
    } else if (type === 'clear') {
      idMap.delete(id)
    }
  })
  // setTimeout/setInterval は同じインターフェースを持つので共通関数にしておく
  const setTimer = (
    type: 'setTimeout' | 'setInterval',
    func: TimerHandler,
    duration = 0,
    ...args: unknown[]
  ) => {
    const id = nextId()
    const invokeFunc =
      type === 'setTimeout'
        ? (...args: unknown[]) => {
            func(...args)
            idMap.delete(id)
          }
        : func
    idMap.set(id, { id, type, func: invokeFunc, duration, args })
    worker.postMessage({ id, type, duration } as SetTimerMessage)
    return id
  }
  // clearTimeout/clearInterval は同じインターフェースを持つので共通関数にしておく
  const clearTimer = (type: 'clearTimeout' | 'clearInterval', id: TimerId) => {
    worker.postMessage({ id, type } as ClearTimerMessage)
    idMap.delete(id)
  }
  return {
    setTimeout: (...args: Parameters<setTimeout>) => setTimer('setTimeout', ...args),
    setInterval: (...args: Parameters<setInterval>) => setTimer('setInterval', ...args),
    clearTimeout: (...args: Parameters<clearTimeout>) => clearTimer('clearTimeout', ...args),
    clearInterval: (...args: Parameters<clearInterval>) => clearTimer('clearInterval', ...args),
    terminate: () => worker.terminate(),
  }
}

// timerManagerで動作させるプライベートなworkerコード
const _timerWorker = () => {
  const idMap = new Map<TimerId, number>()
  self.addEventListener('message', (event: MessageEvent<MessageToWorker>) => {
    const { id, type } = event.data
    if (type === 'setTimeout' || type === 'setInterval') {
      const setTimer = self[type]
      const invoke = () => self.postMessage({ id, type: 'invoke' })
      const callback =
        type === 'setTimeout'
          ? () => {
              invoke()
              idMap.delete(id)
            }
          : invoke
      const nativeId = setTimer(callback, event.data.duration)
      idMap.set(id, nativeId)
    }
    if (type === 'clearTimeout' || type === 'clearInterval') {
      const clearTimer = self[type]
      clearTimer(idMap.get(id))
      idMap.delete(id)
    }
  })
}
