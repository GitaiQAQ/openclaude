import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'

type AsyncLocalStorageLike<T> = {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

function createAsyncLocalStorage<T>(): AsyncLocalStorageLike<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req = (0, eval)('require') as ((id: string) => any) | undefined
    if (req) {
      const mod = req('async_hooks') as { AsyncLocalStorage?: new () => AsyncLocalStorageLike<T> }
      if (mod?.AsyncLocalStorage) {
        return new mod.AsyncLocalStorage()
      }
    }
  } catch {
    // browser/no-node runtime fallback
  }

  let current: T | undefined
  return {
    run<R>(store: T, callback: () => R): R {
      const prev = current
      current = store
      try {
        return callback()
      } finally {
        current = prev
      }
    },
    getStore(): T | undefined {
      return current
    },
  }
}

const cwdOverrideStorage = createAsyncLocalStorage<string>()

export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run(cwd, fn)
}

export function pwd(): string {
  return cwdOverrideStorage.getStore() ?? getCwdState()
}

export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
