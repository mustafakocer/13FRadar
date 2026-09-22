// The one clock every EDGAR request waits on, with a throttle that backs
// off when EDGAR does.
//
// SEC's fair-access limit is 10 requests a second per IP; past it EDGAR
// answers 429 or 403 ("Request Rate Threshold Exceeded") and, on a bad day,
// 503 — and a block lasts ten minutes. The old clock ran at a fixed rate and
// the retry loop slept out the block, which is how a history run spent two
// hours at 8 req/s with "constant 503 + backoff" in the log: every retry
// went back in at the same rate that had just been rejected.
//
// This clock is adaptive: a rate-limit answer halves the rate (down to a
// floor) for a cool-down window, a steady run of clean answers walks it
// back up to the ceiling. Pure over an injected `now` so it is testable.
//
//   SEC_RPS   the ceiling, requests per second (default 6 in batch runs —
//             the safe band is 6–8 — and 8 elsewhere)
export class RateClock {
  constructor({ rps = 6, floor = 1, cooldownMs = 60_000, recoverAfter = 200, now = () => Date.now() } = {}) {
    this.max = Math.max(floor, rps);
    this.floor = Math.max(0.2, floor);
    this.rate = this.max;
    this.cooldownMs = cooldownMs;
    this.recoverAfter = recoverAfter;
    this.now = now;
    this.nextSlot = 0;
    this.clean = 0;
    this.throttledUntil = 0;
    this.stats = { requests: 0, rateLimited: 0, retries: 0, waitedMs: 0 };
  }

  // How long the next request must wait, and book its slot.
  take() {
    const now = this.now();
    if (this.rate < this.max && now >= this.throttledUntil && this.clean >= this.recoverAfter) {
      this.rate = Math.min(this.max, this.rate * 2);
      this.clean = 0;
      this.throttledUntil = now + this.cooldownMs;
    }
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + 1000 / this.rate;
    this.stats.requests++;
    const wait = at - now;
    this.stats.waitedMs += wait;
    return wait;
  }

  // EDGAR said no (429/403/503): halve the rate and hold it for the cool-down.
  noteRateLimited() {
    this.stats.rateLimited++;
    this.rate = Math.max(this.floor, this.rate / 2);
    this.clean = 0;
    this.throttledUntil = this.now() + this.cooldownMs;
  }

  noteOk() {
    this.clean++;
  }

  noteRetry() {
    this.stats.retries++;
  }

  snapshot() {
    return { rate: this.rate, max: this.max, ...this.stats };
  }
}
