# Third-party notices

## LiftShift

The anatomical muscle outlines in
`apps/mobile/src/components/charts/body-map-paths.ts`, and the volume-landmark
model they are coloured by
(`apps/mobile/src/features/analytics/volume-landmarks.ts`), are derived from
**LiftShift** — https://github.com/aree6/LiftShift — which is licensed under the
GNU Affero General Public License, version 3.

Because that artwork is incorporated here, this project is distributed under the
same licence. See `LICENSE` for the full text.

Note AGPL §13: if you run a modified version of this software so that users
interact with it over a network — which includes the sync API in `apps/api` —
you must offer those users the corresponding source.

### What was changed

- Path data was extracted from LiftShift's React DOM components and regenerated
  as a plain data module for `react-native-svg`.
- Muscle ids were renamed to this project's `MuscleGroup` values
  (`abdominals` → `abs`, `lowerback` → `lower_back`).
- Colouring was rewritten from imperative DOM mutation to declarative props, and
  the ramp re-anchored to this project's palette so it reads on a dark canvas —
  LiftShift's white-to-forest-green ramp assumes a light background.
