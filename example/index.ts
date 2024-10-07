import { clearInterval, setInterval, setTimeout } from '../src'

// import { createWorkerTimer } from '../src'
// const manager = createWorkerTimer()
// const id = manager.setInterval(() => {
// 	console.log('interval')
// }, 1000)

const id = setInterval(() => {
  console.log('interval')
}, 1000)

const id2 = setTimeout(() => {
  clearInterval(id)
}, 5000)
