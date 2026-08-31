/**
 * Serializes work for one identity while allowing unrelated identities to progress in parallel.
 * A rejected task is deliberately swallowed only for purposes of starting its successor; the
 * original caller still receives that rejection.
 */
export class KeyedSerialExecutor {
    private readonly tails = new Map<string, Promise<void>>()

    run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) || Promise.resolve()
        const scheduled = previous.catch(() => undefined).then(task)
        const tail = scheduled.then(() => undefined, () => undefined)
        this.tails.set(key, tail)

        return scheduled.finally(() => {
            if (this.tails.get(key) === tail) {
                this.tails.delete(key)
            }
        })
    }
}
