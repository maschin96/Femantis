/**
 * Wait budget for the first example mesh after an Electron launch. The first launch
 * on a cold CI runner starts Python, imports the Toolbox and reads the mesh; this
 * exceeded the 5 s default on macOS runners (main run 39285725120, PR #25). Only
 * startup waits use it; assertions after user actions keep the default.
 */
export const backendStartup = { timeout: 30_000 };

/**
 * Extra Chromium switches for runners without a GPU (#11). Chromium blocklists software
 * OpenGL (Mesa llvmpipe under Xvfb) for WebGL; the Linux CI job sets
 * FEMANTIS_TEST_CHROMIUM_ARGS="--ignore-gpu-blocklist". Unset locally and on macOS/Windows.
 */
export const chromiumArgs = (process.env.FEMANTIS_TEST_CHROMIUM_ARGS ?? '')
  .split(' ')
  .filter(Boolean);
