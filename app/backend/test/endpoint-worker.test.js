'use strict';
/*
 * The endpoint test has to test the username a rental will actually send.
 *
 * Every rental connects as `<address>.r<rentalid>`, so confirming only the string the
 * user typed proves something that is never used. The failure that gap hides is quiet
 * and expensive: the endpoint saves, rentals are paid for, and none of them can
 * authorise.
 *
 * Both forms are probed because they can differ: the typed base may carry a label the
 * per-rental name drops, and a pool may serve one and refuse the other.
 */
// The route throttles itself to one probe a second so it cannot be turned into a
// fast internal scanner. Read at module load, so it has to be set before the
// require below; these tests probe a stub and need no throttle.
process.env.POOL_TEST_MIN_INTERVAL_MS = '0';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const stratum = require('../stratum');
const auth = require('../auth');

// The cookie name auth.sessionFromReq reads; not exported, so it is named here.
const SESSION_COOKIE = 'pickhash_session';
const { handleApi } = require('../api');

const ADDRESS = 'bc1qfpnrnu89cnzjyka83575gcsduen0k2074ulmkj30mul5mcw8pg6spuedgv';

async function withDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickhash-ep-'));
  db.open(dir);
  // The route refuses to make an outbound connection until a dashboard password exists,
  // so the wizard's "set a password first" step is a server-enforced invariant.
  auth.setPassword(db.get(), 'correct horse battery staple');
  try { return await fn(db.get(), dir); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

async function poolTest(dir, user) {
  const out = { status: 0, json: null };
  const res = {
    writeHead(s) { out.status = s; }, setHeader() {},
    end(p) { try { out.json = JSON.parse(p); } catch { out.json = p; } },
  };
  // This route makes an outbound connection to a user-supplied host, so it is behind
  // both the password requirement and the session/CSRF gate. Drive it as a logged-in
  // browser would rather than reaching past them.
  const session = auth.createSession();
  const req = {
    method: 'POST',
    url: '/api/setup/pool-test',
    headers: { cookie: `${SESSION_COOKIE}=${session.id}`, 'x-csrf-token': session.csrf },
  };
  await handleApi(
    req, res,
    new URL('/api/setup/pool-test', 'http://x'),
    { host: '127.0.0.1', port: 3333, user }, { dataDir: dir },
  );
  return out;
}

/** Stand in for a stratum server with a rule about which usernames it will serve. */
function serverThatAccepts(predicate) {
  const seen = [];
  const real = stratum.probe;
  stratum.probe = async (host, port, user) => {
    seen.push(user);
    return predicate(user)
      ? { reachable: true, gotWork: true, difficulty: 1024, msToSubscribe: 5, msToFirstWork: 9, error: null }
      : { reachable: true, gotWork: false, difficulty: null, error: 'unauthorized' };
  };
  return { seen, restore: () => { stratum.probe = real; } };
}

test('a strict server that rejects the per-rental username fails the test, and saves nothing', async () => {
  await withDb(async (conn, dir) => {
    // A pool that takes the address and nothing else: the bare address authorises, the
    // same address with a worker name after it does not. Saving on the strength of the
    // first would buy rentals that can never authorise.
    const srv = serverThatAccepts((u) => u === ADDRESS);
    try {
      const r = await poolTest(dir, ADDRESS);
      assert.equal(r.json.ok, false, 'must not pass on the strength of a username rentals never send');
      assert.equal(r.json.probe.gotWork, true, 'the typed username did work, which is why this was invisible');
      assert.equal(r.json.rental_worker_ok, false);
      assert.equal(r.json.rental_worker, `${ADDRESS}.r9999999`);
      assert.deepEqual(srv.seen, [ADDRESS, `${ADDRESS}.r9999999`], 'both forms are tried');
      assert.equal(conn.prepare('SELECT COUNT(*) n FROM pool_endpoints').get().n, 0, 'nothing saved');
    } finally { srv.restore(); }
  });
});

test('address.worker survives the suffix, so it passes and saves', async () => {
  await withDb(async (conn, dir) => {
    // The rule a real pool applies: everything before the first dot must be the address.
    const srv = serverThatAccepts((u) => u.split('.')[0] === ADDRESS);
    try {
      const r = await poolTest(dir, `${ADDRESS}.phash`);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.rental_worker_ok, true);
      const row = conn.prepare('SELECT worker_base, active FROM pool_endpoints').get();
      assert.equal(row.worker_base, `${ADDRESS}.phash`, 'the full entered username is stored; rentals take the address out of it');
      assert.equal(row.active, 1);
    } finally { srv.restore(); }
  });
});

test('a bare address is no longer a trap — it passes the per-rental probe too', async () => {
  await withDb(async (conn, dir) => {
    // Convoy's rule, and the reason for the naming change: one period, address first,
    // and no dash anywhere. Under the old `<base>-r<id>` form a bare address produced
    // `<address>-r9999999`, which this server refuses; now it produces
    // `<address>.r9999999`, which it serves.
    const srv = serverThatAccepts((u) => u.split('.')[0] === ADDRESS && !u.includes('-'));
    try {
      const r = await poolTest(dir, ADDRESS);
      assert.equal(r.json.ok, true, 'a bare address is a complete answer now');
      assert.equal(r.json.rental_worker, `${ADDRESS}.r9999999`);
      assert.equal(conn.prepare('SELECT worker_base FROM pool_endpoints').get().worker_base, ADDRESS);
    } finally { srv.restore(); }
  });
});

test('a username with no address is refused before it can name a rental', async () => {
  await withDb(async (conn, dir) => {
    const srv = serverThatAccepts(() => true);
    try {
      // Passes the charset check, but leaves nothing before the first period — every
      // rental would be named after an empty address.
      assert.equal((await poolTest(dir, '.phash')).json.error, 'invalid_worker');
      assert.equal(srv.seen.length, 0, 'rejected without opening a connection');
      assert.equal(conn.prepare('SELECT COUNT(*) n FROM pool_endpoints').get().n, 0);
    } finally { srv.restore(); }
  });
});

test('an endpoint that serves nothing is not probed twice', async () => {
  await withDb(async (conn, dir) => {
    const srv = serverThatAccepts(() => false);
    try {
      const r = await poolTest(dir, `${ADDRESS}.phash`);
      assert.equal(r.json.ok, false);
      // Nothing to distinguish when the base already failed, so do not spend a second
      // probe and a second timeout on it.
      assert.equal(srv.seen.length, 1);
      assert.equal(r.json.rental_probe, null);
    } finally { srv.restore(); }
  });
});
