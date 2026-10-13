import * as THREE from 'three';

const namespace = 'http://www.w3.org/2000/svg';
const axes = [
  { name: 'X', direction: new THREE.Vector3(1, 0, 0), color: '#c74e5c' },
  { name: 'Y', direction: new THREE.Vector3(0, 1, 0), color: '#27885b' },
  { name: 'Z', direction: new THREE.Vector3(0, 0, 1), color: '#3478c4' },
];

function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(namespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/** Screen-space indicator of the unchanged global mesh axes. */
export class OrientationGizmo {
  private root = document.createElement('div');
  private svg = element('svg', {
    viewBox: '0 0 144 144',
    role: 'img',
    'aria-label': 'Koordinatensystem: positive X-, Y- und Z-Richtung',
  });
  private inverse = new THREE.Quaternion();
  private arms = axes.map((axis) => {
    const group = element('g', {});
    const line = element('line', {
      'data-axis': axis.name.toLowerCase(),
      x1: '72',
      y1: '72',
      stroke: axis.color,
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
    });
    const arrow = element('polygon', { fill: axis.color });
    const label = element('g', {});
    label.append(
      element('circle', { r: '10', fill: axis.color }),
      element('text', {
        y: '0.5',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'white',
      }),
    );
    label.lastChild!.textContent = axis.name;
    group.append(line, arrow, label);
    const negative = element('line', {
      x1: '72',
      y1: '72',
      stroke: axis.color,
      'stroke-width': '1.5',
      'stroke-dasharray': '3 3',
      opacity: '0.35',
    });
    return { ...axis, group, line, arrow, label, negative, projected: new THREE.Vector3() };
  });

  constructor(host: HTMLElement) {
    this.root.className = 'orientation-gizmo';
    this.root.title = 'Globale Koordinaten · Pfeile zeigen die positive Achsenrichtung';
    this.svg.append(
      element('circle', { cx: '72', cy: '72', r: '61', fill: '#ffffffcc', stroke: '#d9e3e6' }),
      ...this.arms.map((arm) => arm.negative),
      element('circle', { cx: '72', cy: '72', r: '3', fill: '#71858f' }),
    );
    const caption = document.createElement('span');
    caption.textContent = 'Koordinaten';
    this.root.append(this.svg, caption);
    host.append(this.root);
  }

  update(camera: THREE.Camera): void {
    this.inverse.copy(camera.quaternion).invert();
    for (const arm of this.arms) {
      arm.projected.copy(arm.direction).applyQuaternion(this.inverse);
      const dx = arm.projected.x;
      const dy = -arm.projected.y;
      const x = 72 + dx * 42;
      const y = 72 + dy * 42;
      arm.line.setAttribute('x2', String(x));
      arm.line.setAttribute('y2', String(y));
      arm.negative.setAttribute('x2', String(72 - dx * 26));
      arm.negative.setAttribute('y2', String(72 - dy * 26));
      arm.label.setAttribute('transform', `translate(${72 + dx * 55} ${72 + dy * 55})`);
      const length = Math.hypot(dx, dy);
      arm.arrow.style.display = length < 0.05 ? 'none' : '';
      if (length >= 0.05) {
        const ux = dx / length;
        const uy = dy / length;
        arm.arrow.setAttribute(
          'points',
          `${x},${y} ${x - ux * 7 - uy * 3},${y - uy * 7 + ux * 3} ${x - ux * 7 + uy * 3},${y - uy * 7 - ux * 3}`,
        );
      }
    }
    // Draw the axes nearest the viewer last, including end-on labels.
    for (const arm of [...this.arms].sort((a, b) => a.projected.z - b.projected.z))
      this.svg.append(arm.group);
  }

  dispose(): void {
    this.root.remove();
  }
}
