# 巷口散步｜Neighborhood Walk

Original third-person neighborhood walking prototype. 原創概略場景・非實景測繪。

WASD / arrows move; Shift runs; drag rotates the camera; wheel zooms; R resets; M toggles the minimap; H opens help; Esc pauses; Enter resumes. Touch controls are provided.

The street layout, buildings, dimensions and scenery are original approximations, not a reconstruction or survey of a real address. No Google images, textures, extracted meshes or traced map geometry are included. Activity is limited to a 100 m virtual radius. The scene has no interiors or terrain-height simulation.

Runtime assets are bundled locally. No API keys, telemetry, geolocation request or third-party CDN. Hosting requests are handled by GitHub Pages. Three.js is MIT licensed; see vendor/THREE-LICENSE.txt.

## Development
Node.js: npm install, npm run build, npm test. The browser requires WebGL 2.

## Verification
18 movement/collision tests pass, including actual-scene random walks. GLB was imported by Blender 4.3.2 and Three.js GLTFLoader. Browser interaction and device compatibility are not implied by these automated tests.
