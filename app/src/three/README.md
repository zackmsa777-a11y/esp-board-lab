# Device models

The built-in pill is original procedural geometry. No STEP data or converted
upstream mesh is checked into this repository, copied into public/, or bundled.

The official model is fetched only by the user's download button. A dedicated
classic worker verifies the profile's SHA-256 before loading occt-import-js or
converting anything. It transfers typed mesh buffers to the UI; the UI caches
them in IndexedDB under a converter-schema/source-hash key. Clearing site data
removes the cache. Selecting an uncached official model uses the built-in pill
until the user requests a download. A cache write failure keeps the session's
model usable. Download cancellation terminates the worker.

Vite copies the unmodified npm converter JS/WASM and both license notices into
`public/model-converter/` (ignored), served separately from the application
bundle. They are loaded via importScripts only during conversion, and can be
replaced by an ABI-compatible LGPL build. See ATTRIBUTION.md for source/build
links. The app does not fetch external environment images or fonts.

Coordinates are millimeters in the source frame: x along the device, front -z.
The scene rotates the entire assembly by pi around x to face a conventional
+z camera. The screen uses the same pixel rotation as the 2D canvas; its local
180-degree x rotation preserves reading orientation in the assembly. The
profile's extra screen.rotate is an optional mounting correction.

Measured cover-B front boundary loops at z=-2.2 mm:

- Screen aperture: x -33.554..10.4045; y -11.9668..11.9668. Center
  (-11.57475, 0), size 43.9585 x 23.9336 mm. Screen plane z=-2.215,
  glass z=-2.25, both inside the rectangular aperture footprint.
- Knob hole: center (28, 0). Front chamfer radius 14.1263; bore radius
  13.6263 at z=-1.709. Knob radius 13.2, center z=-4.7, height 6.
- GPIO6 key placement is approximate: -y side at (30,-19.8,9), near knob.
  This is explicitly called out in the UI; the STEP has no identified key hole.

The canvas renders on demand. A new framebuffer or display power state updates
the unlit sRGB texture and invalidates once; OrbitControls invalidates while
damping. DeviceScene is memoized so CPU status and unrelated part updates do
not continuously invalidate the canvas. The emulator worker is unchanged.

Knob wheel input uses the existing ordered 45ms encoder queue. Vertical knob
drag advances one 18-degree detent per 12 CSS pixels. A 160ms drag threshold
distinguishes rotation from a push; a stationary held pointer presses until
release. A quick click sends a 90ms press/release. Pointer cancellation, blur,
mode changes and unmount release held inputs. Native buttons below the view
and the existing keyboard shortcuts are available without 3D hit targets.
