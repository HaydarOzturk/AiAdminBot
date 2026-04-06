/**
 * Lightweight Express test helper using Node's built-in http
 *
 * Usage:
 *   const app = require('../../src/web/server');
 *   const testApp = createTestApp(app);
 *   before(async () => await testApp.start());
 *   after(async () => await testApp.stop());
 *   const res = await testApp.get('/api/stats');
 */

const http = require('http');

function createTestApp(app) {
  const server = http.createServer(app);

  async function request(method, urlPath, opts = {}) {
    const { body, headers = {}, cookies } = opts;

    return new Promise((resolve, reject) => {
      const port = server.address().port;
      const options = {
        method,
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers: { ...headers },
      };

      if (cookies) options.headers.cookie = cookies;
      if (body) {
        const bodyStr = JSON.stringify(body);
        options.headers['content-type'] = 'application/json';
        options.headers['content-length'] = Buffer.byteLength(bodyStr);
      }

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
            raw: data,
          });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  return {
    start: () => new Promise((r) => server.listen(0, '127.0.0.1', r)),
    stop: () => new Promise((r) => server.close(r)),
    get: (p, o) => request('GET', p, o),
    post: (p, o) => request('POST', p, o),
    put: (p, o) => request('PUT', p, o),
    delete: (p, o) => request('DELETE', p, o),
  };
}

module.exports = { createTestApp };
