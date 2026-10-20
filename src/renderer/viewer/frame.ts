/** Insets in CSS pixels that floating glass panels cover on each edge of the canvas. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Projection window for the free area between floating panels. `offsetX`/`offsetY` are the
 * `PerspectiveCamera.setViewOffset` origin that moves the optical axis to the free area's
 * centre; `width`/`height` are the free area's size. Insets that would leave less than a
 * quarter of the canvas in either direction are ignored (narrow windows, hidden canvas).
 * Display only: the mesh coordinates and field values are never touched.
 */
export function viewFrame(width: number, height: number, insets: Insets) {
  const freeWidth = width - insets.left - insets.right;
  const freeHeight = height - insets.top - insets.bottom;
  if (freeWidth < width / 4 || freeHeight < height / 4)
    return { offsetX: 0, offsetY: 0, width, height };
  return {
    offsetX: (insets.right - insets.left) / 2,
    offsetY: (insets.bottom - insets.top) / 2,
    width: freeWidth,
    height: freeHeight,
  };
}

/**
 * Camera distance at which a sphere of `radius` fits the free area with the 15% margin
 * the viewer has always used. `fov` is the camera's vertical field of view in degrees
 * over the full canvas height; the free area sees a proportionally narrower angle.
 */
export function fitDistance(
  radius: number,
  fov: number,
  width: number,
  height: number,
  frame: ReturnType<typeof viewFrame>,
): number {
  const half = Math.atan((Math.tan(((fov / 2) * Math.PI) / 180) * frame.height) / height);
  return (radius / Math.sin(half)) * 1.15 * Math.max(1, frame.height / frame.width);
}
