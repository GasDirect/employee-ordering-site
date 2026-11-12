'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../assets/search.js');
const products = require('../data/products.json').products.filter(p => p.active !== false);

function find(query) {
  const compiled = search.compile(query);
  return products.filter(product => search.score(product, compiled) > 0);
}

function includes(query, id) {
  return find(query).some(product => product.id === id);
}

test('Coke includes Coca-Cola and Diet Coke, but not Sprite or Fanta', () => {
  assert.ok(includes('Coke', 'walmart-161'));
  assert.ok(includes('Coke', 'walmart-094'));
  assert.ok(includes('Coca Cola', 'sams-022'));
  assert.ok(find('Coke').every(p => p.brand === 'Coca-Cola' || p.brand === 'Diet Coke'));
});

test('Coke Zero and Diet Coke remain distinct varieties', () => {
  assert.ok(includes('Coke Zero', 'walmart-098'));
  assert.ok(!find('Coke Zero').some(p => p.brand === 'Diet Coke'));
  assert.ok(includes('Diet Coke', 'walmart-094'));
  assert.ok(!includes('Diet Coke', 'walmart-098'));
});

test('Common brand nicknames resolve without loose ownership matching', () => {
  assert.ok(includes('Mtn Dew', 'sams-030'));
  assert.ok(includes('Mt Dew', 'sams-030'));
  assert.ok(includes('7 up', 'walmart-096'));
  assert.ok(find('redbull').some(p => p.brand === 'Red Bull'));
  assert.ok(includes('Body Armor', 'sams-141'));
  assert.ok(includes('Power Aid', 'sams-156'));
  assert.ok(find('Pepsi').every(p => p.brand !== 'Mountain Dew'));
});

test('Pack quantity and individual size are different dimensions', () => {
  assert.ok(includes('12 pack', 'walmart-041'));
  assert.ok(!includes('12 pack', 'walmart-051'));
  assert.ok(includes('24 pack', 'walmart-051'));
  assert.ok(includes('Coke 2 liter', 'walmart-161'));
  assert.ok(!includes('12 pack', 'sams-141'));
});

test('Search words work in any order and with equivalent units', () => {
  const ids = q => find(q).map(p => p.id).sort();
  assert.deepEqual(ids('Sprite 2 liter'), ids('2L Sprite'));
  assert.ok(includes('Sprite 2-Liter', 'walmart-091'));
  assert.ok(includes('Gatorade 24pk', 'sams-153'));
  assert.ok(includes('24 pack Gatorade', 'sams-154'));
  assert.deepEqual(ids('Monster 24 pack Zero'), ids('24Pk Zero Monster'));
});

test('Product number searches remain exact, including leading zeroes', () => {
  assert.ok(includes('13857469882', 'sams-026'));
  assert.ok(!includes('1385746988', 'sams-026'));
});

test('Typing a prefix works, without speculative typo correction', () => {
  assert.ok(includes('Mount', 'sams-030'));
  assert.equal(find('Gatoraid').length, 0);
});

test('Empty search leaves products available for normal browsing', () => {
  assert.ok(search.score(products[0], search.compile('')) > 0);
  assert.ok(search.score(products[0], search.compile('  ')) > 0);
});
