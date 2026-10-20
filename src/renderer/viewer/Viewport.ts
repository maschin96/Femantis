import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MeshPacket, ViewState } from '../../shared/types';
import { buildDisplay, cellPalette } from './display';
import type { ResultField } from '../../shared/types';
import { scalarValues, fieldLimits, gpuFieldValues } from './fields';
import { OrientationGizmo } from './OrientationGizmo';

/**
 * User Timing entries (`femantis:*`) for the viewer benchmark (#8). Only user actions
 * are measured, never single frames, so the timeline grows with interaction only.
 */
function measured<T>(name: string, action: () => T): T {
  const start = performance.now();
  try {
    return action();
  } finally {
    performance.measure(`femantis:${name}`, { start, end: performance.now() });
  }
}

/** Viridis after scalar interpolation; clipping happens per fragment (expects `value`). */
const viridis = `float t=clamp(value,0.0,1.0);vec3 a=vec3(0.0578054,0.0003035,0.0886556);vec3 b=vec3(0.0437350,0.0843762,0.2581829);vec3 c0=vec3(0.0152085,0.2831487,0.2622507);vec3 d=vec3(0.1119324,0.5840784,0.1221388);vec3 e=vec3(0.9822506,0.7991027,0.0185002);vec3 col=t<0.25?mix(a,b,t*4.0):t<0.5?mix(b,c0,(t-0.25)*4.0):t<0.75?mix(c0,d,(t-0.5)*4.0):mix(d,e,(t-0.75)*4.0);gl_FragColor=vec4(col,1.0);\n#include <colorspace_fragment>\n`;

export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
  private controls: OrbitControls;
  private orientation: OrientationGizmo;
  private surface = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.12,
    }),
  );
  private edges = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x153f4c, transparent: true, opacity: 0.55 }),
  );
  private points = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0x153f4c, size: 4, sizeAttenuation: false }),
  );
  private highlight = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0x2ecc71,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  private helpers = new THREE.Group();
  private observer: ResizeObserver;
  private origin = new THREE.Vector3();
  private extent = 1;
  private radius = 1;
  private rendered: Uint32Array = new Uint32Array(0);
  private displayIndex: Int32Array = new Int32Array(0);
  private displayCoordinates: Float32Array = new Float32Array(0);
  private rowsPerTriangle = 1;
  private palette: Float32Array;
  private selected: number | null = null;
  private view: ViewState;
  private pointerStart = { x: 0, y: 0 };
  private disposed = false;
  private standardMaterial: THREE.Material;
  private resultField: ResultField | null = null;
  private resultValues: Float64Array | null = null;
  private gpuValues: Float32Array | null = null;
  private deformation: Float64Array | null = null;
  private deformationFactor = 0;
  private fieldMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `attribute float femValue; varying float value; void main(){value=femValue;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying float value;void main(){${viridis}}`,
  });
  /**
   * Tet10 nodal fields (#9): face-local area coordinates are affine on the flat face, so
   * evaluating the Triangle6 shape functions per fragment reproduces the quadratic field.
   */
  private quadraticMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: `attribute vec3 femLambda; attribute vec3 femCorner; attribute vec3 femMid; varying vec3 l; varying vec3 c; varying vec3 m; void main(){l=femLambda;c=femCorner;m=femMid;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 l; varying vec3 c; varying vec3 m; void main(){vec3 nc=l*(2.0*l-1.0);vec3 nm=4.0*vec3(l.x*l.y,l.y*l.z,l.z*l.x);float value=dot(nc,c)+dot(nm,m);${viridis}}`,
  });

  constructor(
    private host: HTMLElement,
    private mesh: MeshPacket,
    view: ViewState,
    private onPick: (triangle: number | null) => void,
    private onCamera: (camera: NonNullable<ViewState['camera']>) => void,
  ) {
    this.view = view;
    this.standardMaterial = this.surface.material;
    this.palette = cellPalette(mesh);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xf4f7f8);
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interaktive 3D-Darstellung des FEM-Netzes',
    );
    this.host.append(this.renderer.domElement);
    this.orientation = new OrientationGizmo(this.host);
    const bounds = new THREE.Box3();
    for (let index = 0; index < mesh.positions.length; index += 3)
      bounds.expandByPoint(
        new THREE.Vector3(
          mesh.positions[index],
          mesh.positions[index + 1],
          mesh.positions[index + 2],
        ),
      );
    bounds.getCenter(this.origin);
    this.extent = Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1e-9);
    this.radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 1e-9);
    this.camera.up.set(0, 0, 1);
    this.camera.near = this.extent / 10000;
    this.camera.far = this.extent * 1000;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = this.extent * 0.02;
    this.controls.maxDistance = this.extent * 100;
    this.controls.addEventListener('change', this.render);
    this.controls.addEventListener('end', this.cameraChanged);
    this.scene.add(this.surface, this.edges, this.points, this.highlight);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667b83, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 2.1);
    light.position.set(this.extent, -this.extent, this.extent * 2);
    this.scene.add(light);
    const grid = new THREE.GridHelper(this.extent * 3, 24, 0xc6d7dc, 0xe0e9ec);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = bounds.min.z - this.origin.z - this.extent * 0.03;
    this.helpers.add(grid, new THREE.AxesHelper(this.extent * 0.35));
    this.scene.add(this.helpers);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.setView(view);
    this.fit('iso', false);
    if (view.camera) {
      this.camera.position.fromArray(view.camera.position);
      this.controls.target.fromArray(view.camera.target);
      if (this.camera.position.distanceTo(this.controls.target) < this.extent * 0.001)
        this.fit('iso', false);
      else this.controls.update();
    }
    this.resize();
  }

  private render = (): void => {
    if (!this.disposed) {
      this.renderer.render(this.scene, this.camera);
      this.orientation.update(this.camera);
    }
  };
  private resize = (): void => {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  };
  private cameraChanged = (): void => {
    this.onCamera({
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    });
  };
  private pointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };
  private pointerUp = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 4
    )
      return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const hit = measured('pick', () => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, this.camera);
      return ray.intersectObject(this.surface)[0];
    });
    this.onPick(hit?.faceIndex != null ? this.rendered[hit.faceIndex] : null);
  };
  private replaceGeometry(
    object: THREE.Mesh | THREE.LineSegments | THREE.Points,
    geometry: THREE.BufferGeometry,
  ): void {
    object.geometry.dispose();
    object.geometry = geometry;
  }

  setView(view: ViewState): void {
    measured('setView', () => this.buildView(view));
  }

  private buildView(view: ViewState): void {
    this.view = view;
    const display = buildDisplay({
      mesh: this.mesh,
      view,
      origin: [this.origin.x, this.origin.y, this.origin.z],
      palette: this.palette,
      field:
        this.resultField && this.resultValues && this.gpuValues
          ? {
              association: this.resultField.association,
              values: this.resultValues,
              gpu: this.gpuValues,
            }
          : null,
      deformation: this.deformation,
      factor: this.deformationFactor,
    });
    this.rendered = display.rendered;
    this.displayIndex = display.displayIndex;
    this.displayCoordinates = display.coordinates;
    this.rowsPerTriangle = display.rowsPerTriangle;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(display.coordinates, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(display.colors, 3));
    geometry.setAttribute('femValue', new THREE.BufferAttribute(display.femValues, 1));
    if (display.quadratic) {
      geometry.setAttribute('femLambda', new THREE.BufferAttribute(display.quadratic.lambda, 3));
      geometry.setAttribute('femCorner', new THREE.BufferAttribute(display.quadratic.corners, 3));
      geometry.setAttribute('femMid', new THREE.BufferAttribute(display.quadratic.midsides, 3));
    }
    this.surface.material = !this.resultField
      ? this.standardMaterial
      : display.quadratic
        ? this.quadraticMaterial
        : this.fieldMaterial;
    geometry.computeVertexNormals();
    this.replaceGeometry(this.surface, geometry);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(display.edges, 3));
    this.replaceGeometry(this.edges, edgeGeometry);
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute('position', new THREE.BufferAttribute(display.nodes, 3));
    this.replaceGeometry(this.points, nodeGeometry);
    this.edges.visible = view.mode === 'mesh';
    this.points.visible = view.showNodes;
    this.helpers.visible = view.showAxes;
    this.setSelected(this.selected);
    this.render();
    performance.mark('femantis:geometry', {
      detail: {
        surfaceTriangles: this.rendered.length,
        edgeSegments: this.edges.geometry.getAttribute('position').count / 2,
        nodes: this.points.geometry.getAttribute('position').count,
        gpuBytes: this.gpuBytes(),
      },
    });
  }

  /** Bytes of all vertex attributes uploaded for the mesh, edges, nodes and highlight. */
  private gpuBytes(): number {
    let bytes = 0;
    for (const object of [this.surface, this.edges, this.points, this.highlight])
      for (const attribute of Object.values(object.geometry.attributes))
        bytes += (attribute as THREE.BufferAttribute).array.byteLength;
    return bytes;
  }

  setField(
    field: ResultField | null,
    component: string,
    limits: [number, number] | null,
    displacement: Float64Array | null,
    factor: number,
  ): void {
    measured('setField', () => this.applyField(field, component, limits, displacement, factor));
  }

  private applyField(
    field: ResultField | null,
    component: string,
    limits: [number, number] | null,
    displacement: Float64Array | null,
    factor: number,
  ): void {
    const values = field ? scalarValues(field, component) : null;
    const gpu = values ? gpuFieldValues(values, limits || fieldLimits(values)) : null;
    this.resultField = field;
    this.resultValues = values;
    this.gpuValues = gpu;
    this.deformation = displacement;
    this.deformationFactor = factor;
    this.setView(this.view);
  }

  setSelected(triangle: number | null): void {
    measured('setSelected', () => this.applySelected(triangle));
  }

  private applySelected(triangle: number | null): void {
    this.selected = triangle;
    const geometry = new THREE.BufferGeometry();
    const shown = triangle !== null && this.displayIndex[triangle] >= 0;
    if (shown) {
      // All display rows of the mesh triangle (four when a Tet10 face is refined).
      const first = this.displayIndex[triangle] * 9;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(
          this.displayCoordinates.slice(first, first + this.rowsPerTriangle * 9),
          3,
        ),
      );
    }
    this.replaceGeometry(this.highlight, geometry);
    this.highlight.visible = shown;
    this.render();
  }

  fit(preset: 'iso' | 'front' | 'top' | 'side' = 'iso', notify = true): void {
    const directions = {
      iso: [1.1, -1.6, 1.15],
      front: [0, -1, 0.001],
      top: [0, -0.001, 1],
      side: [1, 0, 0.001],
    };
    this.controls.target.set(0, 0, 0);
    const distance =
      (this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2)) *
      1.15 *
      Math.max(1, 1 / this.camera.aspect);
    this.camera.position.fromArray(directions[preset]).normalize().multiplyScalar(distance);
    this.controls.update();
    this.render();
    if (notify) this.cameraChanged();
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments ||
        object instanceof THREE.Points
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.orientation.dispose();
    this.standardMaterial.dispose();
    this.fieldMaterial.dispose();
    this.quadraticMaterial.dispose();
    this.renderer.domElement.remove();
  }
}
