const _parsed = parseInt(process.env.OPENAI_MAX_CONCURRENT || "10", 10);
const MAX_CONCURRENT = Number.isFinite(_parsed) && _parsed >= 1 ? _parsed : 10;

let _inFlight = 0;
const _queue: Array<() => void> = [];

function release(): void {
  _inFlight--;
  if (_queue.length > 0) {
    const next = _queue.shift()!;
    _inFlight++;
    next();
  }
}

export async function withOpenAIConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (_inFlight < MAX_CONCURRENT) {
    _inFlight++;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return new Promise<T>((resolve, reject) => {
    _queue.push(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        release();
      }
    });
  });
}

export function getOpenAIConcurrencyStats(): { inFlight: number; queued: number; max: number } {
  return { inFlight: _inFlight, queued: _queue.length, max: MAX_CONCURRENT };
}
