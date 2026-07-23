import assert from 'node:assert/strict';
import test from 'node:test';

import {
  atlatlCommands,
  calculateAtlatlMaxHit,
  findAtlatlBreakpoints,
} from './atlatl.js';

const exampleInput = {
  visibleStrength: 118,
  meleeStrengthBonus: 110,
  prayer: 'rigour',
  style: 'rapid',
  voidSet: 'none',
  targetBonus: 'none',
  burn: 0,
};

test('matches the 118 Strength, +110 bonus Rigour example', () => {
  const result = calculateAtlatlMaxHit(exampleInput);

  assert.equal(result.prayerAdjustedLevel, 145);
  assert.equal(result.effectiveLevel, 153);
  assert.equal(result.maxHit, 42);
  assert.equal(result.fullBurnSpecialMinHit, 25);
  assert.equal(result.fullBurnSpecialMaxHit, 92);
});

test('applies Accurate, Elite Void, and Slayer bonuses in game order', () => {
  const result = calculateAtlatlMaxHit({
    ...exampleInput,
    style: 'accurate',
    voidSet: 'elite',
    targetBonus: 'slayer',
    burn: 50,
  });

  assert.equal(result.preVoidEffectiveLevel, 156);
  assert.equal(result.effectiveLevel, 175);
  assert.equal(result.baseMaxHit, 48);
  assert.equal(result.maxHit, 56);
  assert.equal(result.specialMinHit, 25);
  assert.equal(result.specialMaxHit, 106);
});

test('Sharp Eye always grants at least one damage level at low Strength', () => {
  const result = calculateAtlatlMaxHit({
    visibleStrength: 10,
    meleeStrengthBonus: 40,
    prayer: 'sharp_eye',
  });

  assert.equal(result.prayerAdjustedLevel, 11);
  assert.equal(result.effectiveLevel, 19);
});

test('finds the next gear and visible Strength breakpoints', () => {
  const breakpoints = findAtlatlBreakpoints(exampleInput);

  assert.ok(breakpoints.meleeStrengthBonus);
  assert.ok(breakpoints.visibleStrength);
  assert.ok(breakpoints.meleeStrengthBonus.maxHit > 42);
  assert.ok(breakpoints.visibleStrength.maxHit > 42);
});

test('slash command schema is valid and exposes the calculator inputs', () => {
  const command = atlatlCommands[0].toJSON();

  assert.equal(command.name, 'atlatl');
  assert.deepEqual(
    command.options.map(option => option.name),
    ['visible_strength', 'melee_strength', 'prayer', 'style', 'void', 'target', 'burn'],
  );
});
