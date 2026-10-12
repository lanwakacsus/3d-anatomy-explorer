# Anatomy Explorer MVP

A browser-based MVP for exploring segmented 3D human anatomy. Users can orbit, pan,
zoom, toggle anatomy layers, search structures, click meshes to highlight them, and
read metadata in an information panel.

## Run locally

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

The app is static: `index.html`, `styles.css`, and `src/app.js`. It loads Three.js
from a CDN and serves the bundled anatomy assets from `public/anatomy`.

## Included anatomy coverage

- Bones and cartilage: `public/anatomy/models/skeletal.glb`
- Muscles: non-tendon structures from `public/anatomy/models/muscular.glb`
- Tendons and related connective tissues: tendon/aponeurosis/retinaculum/sheath
  structures from `muscular.glb`
- Joints and ligaments: `public/anatomy/models/joints.glb`

The source metadata contains more systems, but this MVP intentionally bundles only
the three GLB files above so the initial viewer stays light and dependable.

## Asset licensing and attribution

The bundled models and metadata are from the public `nqwrc/3d-anatomy` export,
derived from BodyParts3D and Z-Anatomy. Keep these files with any redistribution:

- `public/anatomy/licenses/LICENSE.nqwrc-3d-anatomy.txt`
- `public/anatomy/licenses/NOTICE.nqwrc-3d-anatomy.txt`
- `public/anatomy/licenses/License.models.txt`

Required attribution strings from the notices:

- "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
- "Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0"

Definitions are Wikipedia-derived metadata under CC BY-SA 3.0 / GFDL terms.
The upstream distribution is documented as CC BY-NC-SA 4.0 as a whole because
some systems include non-commercial components. This MVP does not bundle the
`nervous.glb` inner-ear model or `visceral.glb` kidney model, but the included
notice files should still be preserved and reviewed before redistribution.

## Expanding coverage

To add more anatomy systems:

1. Add another Z-Anatomy GLB to `public/anatomy/models`, such as
   `cardiovascular.glb`, `nervous.glb`, or `visceral.glb`.
2. Add a layer entry in `src/app.js` with a category, label, color, and matcher.
3. Add the system id to `RELEVANT_SYSTEMS` so search and metadata indexing include it.
4. Recheck the upstream license notes for the added system before publishing.

The click/highlight system uses each mesh's `extras.za_name` metadata, so new GLBs
should preserve that field when exported.
