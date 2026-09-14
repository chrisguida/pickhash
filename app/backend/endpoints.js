'use strict';
/*
 * The saved stratum endpoint, scoped to the algorithm it belongs to.
 *
 * A BLAKE2b rental has to point at a BLAKE2b stratum. `pool_endpoints` gained an
 * `algo` column in 009, but every read still asked for "the active endpoint" without
 * saying whose, so switching algorithms would have left the previous one's endpoint
 * live: rented hashrate of the right kind, aimed at a pool that cannot use it. That
 * is the same shape as the bug in Datum Gateway (BLAKE2b) where an address was
 * validated against a chain the node was not on. It looks correct locally and only
 * fails somewhere nobody is looking.
 *
 * Each algorithm has at most one active endpoint, and reads are scoped rather than
 * the switch mutating rows. Nothing has to be deactivated on a switch, nothing can
 * get out of step, and switching back finds the endpoint that was there before.
 */
const config = require('./config');

/**
 * The active endpoint for an algorithm, or null.
 *
 * Newest first. Callers used to be split between a bare `.get()` and `ORDER BY id
 * DESC LIMIT 1`, which differ only if more than one row is somehow active — and in
 * that case the newest is the one the user last saved, so it is the better answer
 * for all of them.
 */
function active(conn, algo) {
  const slug = algo || config.activeAlgo(conn);
  return conn.prepare(
    'SELECT * FROM pool_endpoints WHERE active = 1 AND algo = ? ORDER BY id DESC LIMIT 1',
  ).get(slug) || null;
}

/**
 * Stand every endpoint for one algorithm down.
 *
 * Scoped, so saving an endpoint for one algorithm cannot deactivate the other's.
 * Unscoped, a user who set up BLAKE2b would come back to sha256ab and find their
 * endpoint quietly inactive.
 */
function deactivateAll(conn, algo) {
  const slug = algo || config.activeAlgo(conn);
  return conn.prepare('UPDATE pool_endpoints SET active = 0 WHERE algo = ?').run(slug);
}

/**
 * The payout address inside a worker base: everything before the first period.
 *
 * `worker_base` is the FULL username the user typed, which may be a bare address or
 * `address.label`. Pools read the part before the first period as the address, so that
 * is what this returns, and it is the one rule every derived username is built on.
 */
function poolAddress(workerBase) {
  return String(workerBase || '').split('.')[0];
}

/**
 * The stratum username for one rental: `<address>.r<mrrId>`.
 *
 * Pool compatibility, not formatting taste. Rentals used to connect as
 * `<worker_base>-r<id>`: Ocean accepted the dash, Convoy — the main BLAKE2b pool —
 * does not, so on Convoy every rental authorised as nothing and delivered nothing
 * while still billing. `<address>.<worker>` is the form both accept, so it is the
 * only form we send.
 *
 * Deriving the address rather than appending to whatever was typed is what makes the
 * result safe: exactly one period however the user entered it, and a worker segment
 * (`r<id>`) with no separator character in it at all. It also retires the old trap
 * where a bare address — which the charset check allows — had the suffix run into the
 * address itself and be rejected as one invalid address.
 *
 * A label the user typed (`address.phash`) is deliberately not carried into per-rental
 * names: keeping it would need a second separator, which is the thing that broke. It
 * still stands as the username on the shared saved pool (see bootstrap.js).
 *
 * @returns {string|null} null when there is no address to build on, which the endpoint
 *   save path rejects up front rather than letting it reach a rental.
 */
function rentalWorker(workerBase, mrrId) {
  const address = poolAddress(workerBase);
  return address ? `${address}.r${mrrId}` : null;
}

module.exports = { active, deactivateAll, poolAddress, rentalWorker };
