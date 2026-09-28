// An in-memory GitHub issues API behind the axios.create() shape.
export function fakeGitHub({ failWith = null } = {}) {
  const issues = [];
  const calls = [];
  const client = {
    async get(url, { params } = {}) {
      calls.push(['GET', url]);
      if (failWith) return { status: failWith, data: { message: 'nope' } };
      return { status: 200, data: issues.filter((i) => i.state === 'open' && i.labels.includes(params.labels)) };
    },
    async post(url, body) {
      calls.push(['POST', url, body]);
      if (failWith) return { status: failWith, data: { message: 'Resource not accessible by integration' } };
      if (url === '/issues') {
        const i = { number: issues.length + 1, state: 'open', comments: [], ...body };
        issues.push(i);
        return { status: 201, data: i };
      }
      const n = Number(/\/issues\/(\d+)\/comments/.exec(url)[1]);
      issues.find((i) => i.number === n).comments.push(body.body);
      return { status: 201, data: {} };
    },
    async patch(url, body) {
      calls.push(['PATCH', url, body]);
      const n = Number(/\/issues\/(\d+)/.exec(url)[1]);
      Object.assign(issues.find((i) => i.number === n), body);
      return { status: 200, data: {} };
    },
  };
  return { http: { create: () => client }, issues, calls };
}

