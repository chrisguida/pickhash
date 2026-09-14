'use strict';
/*
 * The stratum username every rental connects with.
 *
 * This is a pool-compatibility rule, not a formatting preference, which is why it is
 * pinned here rather than left to the call sites. Rentals used to be named
 * `<worker_base>-r<id>`: Ocean accepted the dash, Convoy — the main BLAKE2b pool — does
 * not. A rental that cannot authorise still bills, so the cost of getting this wrong is
 * paid hashrate delivering nothing, on the pool a BLAKE2b user is most likely to pick.
 *
 * `<address>.r<id>` is the form both accept. The invariants below are what make it safe
 * whatever the user typed: exactly one period, no dash, address first.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const endpoints = require('../endpoints');
const { fallbackWorker } = require('../session');

const ADDRESS = 'bc1qfpnrnu89cnzjyka83575gcsduen0k2074ulmkj30mul5mcw8pg6spuedgv';

test('a bare address and a labelled one produce the same per-rental username', () => {
  // The label is a landing pad for the old dash suffix. Nothing appends to it now, so
  // carrying it would only add a second period — the thing Convoy refuses.
  assert.equal(endpoints.rentalWorker(ADDRESS, 700), `${ADDRESS}.r700`);
  assert.equal(endpoints.rentalWorker(`${ADDRESS}.phash`, 700), `${ADDRESS}.r700`);
  assert.equal(endpoints.rentalWorker(`${ADDRESS}.a.b.c`, 700), `${ADDRESS}.r700`);
});

test('exactly one period, no dash, address first — whatever was typed', () => {
  for (const base of [ADDRESS, `${ADDRESS}.phash`, `${ADDRESS}.my-rig`, `${ADDRESS}.a.b`]) {
    const w = endpoints.rentalWorker(base, 123456);
    assert.equal((w.match(/\./g) || []).length, 1, `one period for ${base}`);
    assert.ok(!w.includes('-'), `no dash for ${base}`);
    assert.equal(w.split('.')[0], ADDRESS, `address survives for ${base}`);
    // The worker segment carries the rental id and nothing a pool has to parse.
    assert.match(w.split('.')[1], /^r\d+$/);
  }
});

test('each rental gets its own worker, so per-rental attribution still works', () => {
  assert.notEqual(endpoints.rentalWorker(ADDRESS, 1), endpoints.rentalWorker(ADDRESS, 2));
});

test('no address means no username, rather than one named after nothing', () => {
  for (const base of ['', null, undefined, '.', '.phash']) {
    assert.equal(endpoints.rentalWorker(base, 700), null, `no username for ${JSON.stringify(base)}`);
  }
});

test('the fallback worker is built on the same address rule', () => {
  // Both names have to survive the same pools, so they agree on what the address is.
  assert.equal(endpoints.poolAddress(`${ADDRESS}.phash`), ADDRESS);
  assert.equal(fallbackWorker(`${ADDRESS}.phash`), `${ADDRESS}.fallback`);
  assert.equal(
    fallbackWorker(`${ADDRESS}.phash`).split('.')[0],
    endpoints.rentalWorker(`${ADDRESS}.phash`, 700).split('.')[0],
  );
});
