import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  landmarksFor,
  LANDMARKS_BY_MUSCLE,
  TRAINING_LEVELS,
  volumeZone,
  type VolumeLandmarks,
} from './landmarks.ts';
import { MUSCLE_GROUPS, type MuscleGroup } from './types.ts';

/** The four landmarks of a row, in the order they are crossed. */
const FIELDS = ['mv', 'mev', 'mav', 'mrv'] as const;

/** Muscles whose row is deliberately all zeros. The buckets that are not muscles. */
const NON_MUSCLES: readonly MuscleGroup[] = ['cardio', 'full_body', 'other'];

function values(landmarks: VolumeLandmarks): number[] {
  return FIELDS.map((field) => landmarks[field]);
}

describe('LANDMARKS_BY_MUSCLE', () => {
  it('covers every muscle group', () => {
    // The point of iterating the union rather than listing names: adding a
    // muscle to `MUSCLE_GROUPS` and forgetting its landmarks fails here rather
    // than colouring it as untrained on the body map forever.
    for (const muscle of MUSCLE_GROUPS) {
      assert.ok(muscle in LANDMARKS_BY_MUSCLE, `${muscle} has no landmarks`);
    }
    assert.equal(Object.keys(LANDMARKS_BY_MUSCLE).length, MUSCLE_GROUPS.length);
  });

  it('is whole sets throughout', () => {
    for (const muscle of MUSCLE_GROUPS) {
      for (const field of FIELDS) {
        const value = LANDMARKS_BY_MUSCLE[muscle][field];
        assert.ok(Number.isInteger(value), `${muscle}.${field} is ${value}, not a whole set`);
        // A landmark of one set cannot be scaled down and stay non-zero, so the
        // beginner row would sit on top of the intermediate one. Nothing in the
        // table is that small, and this says so where a reader will find it.
        assert.ok(value === 0 || value >= 2, `${muscle}.${field} is too small to scale`);
      }
    }
  });

  it('gives the non-muscles a row that claims nothing', () => {
    for (const muscle of NON_MUSCLES) {
      assert.deepEqual(values(LANDMARKS_BY_MUSCLE[muscle]), [0, 0, 0, 0], muscle);
    }
  });
});

describe('landmarksFor', () => {
  it('holds mv <= mev <= mav <= mrv for every muscle at every level', () => {
    for (const muscle of MUSCLE_GROUPS) {
      for (const level of TRAINING_LEVELS) {
        const row = values(landmarksFor(muscle, level));
        for (let i = 1; i < row.length; i++) {
          assert.ok(
            row[i - 1]! <= row[i]!,
            `${muscle} at ${level}: ${FIELDS[i - 1]} ${row[i - 1]} > ${FIELDS[i]} ${row[i]}`,
          );
        }
      }
    }
  });

  it('returns the table itself for an intermediate lifter', () => {
    for (const muscle of MUSCLE_GROUPS) {
      assert.deepEqual(landmarksFor(muscle, 'intermediate'), LANDMARKS_BY_MUSCLE[muscle], muscle);
    }
  });

  it('defaults to intermediate', () => {
    assert.deepEqual(landmarksFor('chest'), landmarksFor('chest', 'intermediate'));
  });

  it('keeps zeros at zero across levels', () => {
    // A muscle that needs no maintenance work does not acquire a requirement by
    // its owner getting stronger, and a non-muscle never grows a scale at all.
    for (const muscle of MUSCLE_GROUPS) {
      for (const field of FIELDS) {
        if (LANDMARKS_BY_MUSCLE[muscle][field] !== 0) continue;
        for (const level of TRAINING_LEVELS) {
          assert.equal(landmarksFor(muscle, level)[field], 0, `${muscle}.${field} at ${level}`);
        }
      }
    }
  });

  it('puts beginners below and advanced above, on every non-zero landmark', () => {
    for (const muscle of MUSCLE_GROUPS) {
      const beginner = landmarksFor(muscle, 'beginner');
      const intermediate = landmarksFor(muscle, 'intermediate');
      const advanced = landmarksFor(muscle, 'advanced');

      for (const field of FIELDS) {
        if (intermediate[field] === 0) continue;
        assert.ok(
          beginner[field] < intermediate[field],
          `${muscle}.${field}: beginner ${beginner[field]} is not below ${intermediate[field]}`,
        );
        assert.ok(
          advanced[field] > intermediate[field],
          `${muscle}.${field}: advanced ${advanced[field]} is not above ${intermediate[field]}`,
        );
      }
    }
  });

  it('rounds to whole sets', () => {
    for (const muscle of MUSCLE_GROUPS) {
      for (const level of TRAINING_LEVELS) {
        for (const value of values(landmarksFor(muscle, level))) {
          assert.ok(Number.isInteger(value), `${muscle} at ${level}: ${value}`);
        }
      }
    }
  });

  it('scales a row the reader can check by hand', () => {
    // Chest is 8/10/20/22, so ×0.7 and ×1.2 land on whole sets without help.
    assert.deepEqual(landmarksFor('chest', 'beginner'), { mv: 6, mev: 7, mav: 14, mrv: 15 });
    assert.deepEqual(landmarksFor('chest', 'advanced'), { mv: 10, mev: 12, mav: 24, mrv: 26 });
  });
});

describe('volumeZone', () => {
  const landmarks: VolumeLandmarks = { mv: 8, mev: 10, mav: 20, mrv: 22 };

  it('reads nothing as untrained', () => {
    assert.equal(volumeZone(0, landmarks), 'untrained');
    assert.equal(volumeZone(-3, landmarks), 'untrained');
  });

  it('lands on the right side of every boundary', () => {
    assert.equal(volumeZone(0.5, landmarks), 'maintenance');
    assert.equal(volumeZone(9, landmarks), 'maintenance');

    // MEV is the first set that counts as growth, not the last that does not.
    assert.equal(volumeZone(10, landmarks), 'growth');
    assert.equal(volumeZone(19, landmarks), 'growth');

    // MAV is the top of the fastest-growing band and belongs to it.
    assert.equal(volumeZone(20, landmarks), 'optimal');
    assert.equal(volumeZone(22, landmarks), 'optimal');

    // Past the ceiling, and only past it.
    assert.equal(volumeZone(22.5, landmarks), 'overreaching');
    assert.equal(volumeZone(40, landmarks), 'overreaching');
  });

  it('never reports a non-muscle as overreaching', () => {
    for (const muscle of NON_MUSCLES) {
      const row = landmarksFor(muscle);
      for (const sets of [1, 5, 40]) {
        assert.equal(volumeZone(sets, row), 'maintenance', `${muscle} at ${sets} sets`);
      }
      assert.equal(volumeZone(0, row), 'untrained', muscle);
    }
  });

  it('judges each muscle against its own row', () => {
    // The whole point of the per-muscle table: 20 weekly sets is a productive
    // week for side-delt-heavy shoulder work and past what triceps recover from.
    assert.equal(volumeZone(20, landmarksFor('shoulders')), 'growth');
    assert.equal(volumeZone(20, landmarksFor('triceps')), 'overreaching');
  });

  it('covers every muscle at every level without falling through', () => {
    for (const muscle of MUSCLE_GROUPS) {
      for (const level of TRAINING_LEVELS) {
        const row = landmarksFor(muscle, level);
        for (let sets = 0; sets <= 40; sets++) {
          const zone = volumeZone(sets, row);
          if (sets === 0) assert.equal(zone, 'untrained', `${muscle} at ${level}`);
          else assert.notEqual(zone, 'untrained', `${muscle} at ${level}, ${sets} sets`);
        }
      }
    }
  });
});
