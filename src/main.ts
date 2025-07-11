import { setupCounter } from './counter.ts'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <a href="https://deno.com/" target="_blank">
      <img src="assets/deno.png" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="assets/typescript.svg" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Deno + TypeScript + Live Reload</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
  </div>
`

setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
