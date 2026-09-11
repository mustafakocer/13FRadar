// Call an API handler in-process (no HTTP hop) and capture its JSON body.
// Used by the SSR function to seed the page's query cache with the same
// data the client would fetch.
export function invoke(handler, query = {}, headers = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return this.headers[k.toLowerCase()];
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
      send(body) {
        resolve({ status: this.statusCode, body });
      },
      end() {
        resolve({ status: this.statusCode, body: null });
      },
    };
    const req = { query: { ...query }, headers, method: 'GET', url: '' };
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((e) => resolve({ status: 500, body: { error: String(e?.message || e) } }));
  });
}

// Run loaders in parallel with a wall-clock budget; a slow upstream must not
// stall the whole page — the client fetches whatever is missing.
export async function withBudget(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((r) => {
    timer = setTimeout(() => r(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
