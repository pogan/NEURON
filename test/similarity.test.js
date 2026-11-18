import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKeys, compareNames, simName, keyPl, keyEn, damerau, jaroWinkler } from '../src/similarity.js';

const score = (a, b) => compareNames(nameKeys(a), nameKeys(b)).score;

test('nazwa do porównań: bez form prawnych, ogólnych słów i z transliteracją', () => {
  assert.equal(simName('Leśna Świeca Sp. z o.o.'), 'LESNA SWIECA');
  assert.equal(simName('NEURON Polska S.A.'), 'NEURON');
  assert.equal(simName('The Group'), 'THE GROUP'); // same ogólne słowa zostają
  assert.equal(simName('ЗУБР'), 'ZUBR');
});

test('klucze fonetyczne', () => {
  assert.equal(keyPl('CHMIEL'), keyPl('HMIEL'));
  assert.equal(keyPl('ZABKA'), keyPl('RZABKA'));
  assert.equal(keyPl('WAWEL'), keyPl('VAVEL'));
  assert.equal(keyPl('KSENON'), keyPl('XENON'));
  assert.equal(keyEn('PHILIPS'), keyEn('FILIPS'));
  assert.equal(keyEn('KNIGHT'), 'NT');
});

test('miary odległości', () => {
  assert.equal(damerau('KODAK', 'KODKA'), 1); // przestawienie liter
  assert.equal(damerau('', 'ABC'), 3);
  assert.ok(jaroWinkler('MARTHA', 'MARHTA') > 0.96);
});

// Zestaw par do strojenia progów: [nazwa, znak, minimalny wynik, maksymalny wynik]
const PAIRS = [
  ['Neurolab', 'NEURO LAB', 1, 1],
  ['Fajrant', 'FAJRANT', 1, 1], // spór o piwo Fajrant: identyczna nazwa
  ['Paczkomat', 'PACZKOMATY', 0.85, 0.99],
  ['Paczkomat', 'Packomat', 0.85, 0.99],
  ['Kroplosfera', 'KROPLOSFERRA', 0.9, 0.99],
  ['Kodak', 'Kodac', 0.9, 0.99],
  ['Nike', 'Nyke', 0.9, 0.99],
  ['Wedel', 'Vedel', 0.9, 0.99],
  ['Chmiel', 'Hmiel', 0.9, 0.99],
  ['Philips', 'Filips', 0.9, 0.99],
  ['Xenon', 'Ksenon', 0.9, 0.99],
  ['Żabka', 'Rzabka', 0.9, 0.99],
  ['Allegro', 'Alegro', 0.9, 0.99],
  ['Tymbark', 'Timbark', 0.9, 0.99],
  ['Coca Cola', 'Koka Kola', 0.9, 0.99],
  ['Lajkonik', 'Laikonik', 0.9, 0.99],
  ['Wawel', 'Vavel', 0.9, 0.99],
  ['Mleczna Droga', 'Droga Mleczna', 0.9, 0.99],
  ['Neuron', 'NEURON LAB', 0.85, 0.99],
  ['Leśna Świeca', 'LESNA SWIECA sp. z o.o.', 1, 1],
  ['Kubuś', 'Kubus', 1, 1],
  ['Orlen', 'Orlan', 0.85, 0.95],
  ['Morele', 'Morela', 0.85, 0.95],
  ['Neuron', 'Neutron', 0.8, 0.9],
  ['Biedronka', 'Biedroneczka', 0.75, 0.9],
  ['Media Expert', 'Media Markt', 0.7, 0.85],
  ['Neuron', 'Markoskop', 0, 0.55],
  ['Kawa', 'Java', 0.6, 0.8],
  ['Delta', 'Delfin', 0.6, 0.75],
  ['Sprawdź nazwę', 'SportSense', 0, 0.6],
  ['Mleczna Droga', 'TWOJA MLECZNA DROGA', 0.85, 0.95],
  ['Markoskop', 'ARKOS', 0.6, 0.74],
  ['Leśna Świeca', 'ŚWIECA CARITAS', 0.55, 0.65], // jedno wspólne, opisowe słowo
];

for (const [a, b, min, max] of PAIRS) {
  test(`para: ${a} ~ ${b}`, () => {
    const s = score(a, b);
    assert.ok(s >= min && s <= max, `${a} ~ ${b}: ${s.toFixed(2)} poza [${min}, ${max}]`);
  });
}
