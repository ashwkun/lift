# Third-party notices

## LiftShift

The anatomical muscle outlines in
`apps/mobile/src/components/charts/body-map-paths.ts`, and the volume-landmark
model they are coloured by
(`apps/mobile/src/features/analytics/volume-landmarks.ts`), are derived from
**LiftShift** (https://github.com/aree6/LiftShift), which is licensed under the
GNU Affero General Public License, version 3.

Because that artwork is incorporated here, this project is distributed under the
same licence. See `LICENSE` for the full text.

Note AGPL §13: if you run a modified version of this software so that users
interact with it over a network, which includes the sync API in `apps/api`.
You must offer those users the corresponding source.

## Bundled audio

Both rest-timer cues in `apps/mobile/assets/sounds/` came from Freesound, whose
download filenames encode the sound id and the uploader:

| File | Freesound id | Uploader |
| --- | --- | --- |
| `rest_complete.wav` | [276954](https://freesound.org/s/276954/) | `rjz7584` |
| `countdown_beep.wav` | [536422](https://freesound.org/s/536422/) | `rudmer_rotteveel` |

Both were downmixed to mono 44.1 kHz 16-bit PCM and renamed for their role here;
neither was otherwise edited.

**The licence on each is not recorded yet and needs to be.** Freesound assigns a
licence per sound rather than per site: CC0, CC-BY 4.0, CC-BY-NC and Sampling+
are all in use there, and the three that are not CC0 place real conditions on a
distributed binary: CC-BY needs the attribution above carried into the app, and
CC-BY-NC cannot be shipped in anything commercial at all. Check both sound pages
and record what they say before this leaves sideloading.

### What was changed

- Path data was extracted from LiftShift's React DOM components and regenerated
  as a plain data module for `react-native-svg`.
- Muscle ids were renamed to this project's `MuscleGroup` values
  (`abdominals` → `abs`, `lowerback` → `lower_back`).
- Colouring was rewritten from imperative DOM mutation to declarative props, and
  the ramp re-anchored to this project's palette so it reads on a dark canvas.
  LiftShift's white-to-forest-green ramp assumes a light background.
