import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MeshPacket, ViewState } from '../../shared/types';
import { selectedTriangles, visibleTriangles } from './geometry';
import type { ResultField } from '../../shared/types';
import { scalarValues, fieldLimits } from './fields';
import { OrientationGizmo } from './OrientationGizmo';

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
  private rendered: number[] = [];
  private selected: number | null = null;
  private view: ViewState;
  private pointerStart = { x: 0, y: 0 };
  private disposed = false;
  private standardMaterial: THREE.Material;
  private resultField: ResultField | null = null;
  private resultValues: Float64Array | null = null;
  private deformation: Float64Array | null = null;
  private deformationFactor = 0;
  private fieldMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { low: { value: 0 }, high: { value: 1 } },
    vertexShader: `attribute float femValue; varying float value; void main(){value=femValue;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform float low;uniform float high;varying float value;void main(){float t=clamp((value-low)/(high-low),0.0,1.0);vec3 a=vec3(0.0578054,0.0003035,0.0886556);vec3 b=vec3(0.0437350,0.0843762,0.2581829);vec3 c=vec3(0.0152085,0.2831487,0.2622507);vec3 d=vec3(0.1119324,0.5840784,0.1221388);vec3 e=vec3(0.9822506,0.7991027,0.0185002);vec3 col=t<0.25?mix(a,b,t*4.0):t<0.5?mix(b,c,(t-0.25)*4.0):t<0.75?mix(c,d,(t-0.5)*4.0):mix(d,e,(t-0.75)*4.0);gl_FragColor=vec4(col,1.0);\n#include <colorspace_fragment>\n }`,
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
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObject(this.surface)[0];
    this.onPick(hit?.faceIndex != null ? this.rendered[hit.faceIndex] : null);
  };
  private vertex(index: number): number[] {
    return [
      this.mesh.positions[index * 3] -
        this.origin.x +
        (this.deformation?.[index * 3] || 0) * this.deformationFactor,
      this.mesh.positions[index * 3 + 1] -
        this.origin.y +
        (this.deformation?.[index * 3 + 1] || 0) * this.deformationFactor,
      this.mesh.positions[index * 3 + 2] -
        this.origin.z +
        (this.deformation?.[index * 3 + 2] || 0) * this.deformationFactor,
    ];
  }
  private replaceGeometry(
    object: THREE.Mesh | THREE.LineSegments | THREE.Points,
    geometry: THREE.BufferGeometry,
  ): void {
    object.geometry.dispose();
    object.geometry = geometry;
  }

  setView(view: ViewState): void {
    this.view = view;
    this.rendered = visibleTriangles(this.mesh, view).filter(
      (triangle) =>
        !this.resultValues ||
        (this.resultField?.association === 'cell'
          ? Number.isFinite(this.resultValues[this.mesh.triangleOwners[triangle]])
          : [0, 1, 2].every((local) =>
              Number.isFinite(this.resultValues![this.mesh.triangles[triangle * 3 + local]]),
            )),
    );
    const selected = selectedTriangles(this.mesh, view.selectedGroup);
    const coordinates = new Float32Array(this.rendered.length * 9);
    const colors = new Float32Array(coordinates.length);
    const femValues = new Float32Array(this.rendered.length * 3);
    const palette = [0x548b95, 0x8abeb2, 0x729bbd, 0xb7c4a1];
    const cellColors = new Map<number, number>();
    this.mesh.groups
      .filter((group) => group.kind === 'volume')
      .forEach((group, index) =>
        group.members.forEach((cell) => {
          if (!cellColors.has(cell)) cellColors.set(cell, palette[index % palette.length]);
        }),
      );
    const color = new THREE.Color();
    const edgeCoordinates: number[] = [];
    const edges = new Set<string>();
    const visibleNodes = new Set<number>();
    this.rendered.forEach((triangle, displayIndex) => {
      color.setHex(
        selected.has(triangle)
          ? 0x2ecc71
          : (cellColors.get(this.mesh.triangleOwners[triangle]) ?? 0x6798a2),
      );
      for (let local = 0; local < 3; local++) {
        const node = this.mesh.triangles[triangle * 3 + local];
        visibleNodes.add(node);
        coordinates.set(this.vertex(node), displayIndex * 9 + local * 3);
        colors.set(color.toArray(), displayIndex * 9 + local * 3);
        if (this.resultValues)
          femValues[displayIndex * 3 + local] =
            this.resultValues[
              this.resultField?.association === 'cell' ? this.mesh.triangleOwners[triangle] : node
            ];
        const next = this.mesh.triangles[triangle * 3 + ((local + 1) % 3)];
        const key = node < next ? `${node}:${next}` : `${next}:${node}`;
        if (!edges.has(key)) {
          edges.add(key);
          edgeCoordinates.push(...this.vertex(node), ...this.vertex(next));
        }
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('femValue', new THREE.BufferAttribute(femValues, 1));
    geometry.computeVertexNormals();
    this.replaceGeometry(this.surface, geometry);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeCoordinates, 3));
    this.replaceGeometry(this.edges, edgeGeometry);
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...visibleNodes].flatMap((index) => this.vertex(index)),
        3,
      ),
    );
    this.replaceGeometry(this.points, nodeGeometry);
    this.edges.visible = view.mode === 'mesh';
    this.points.visible = view.showNodes;
    this.helpers.visible = view.showAxes;
    this.setSelected(this.selected);
    this.render();
  }

  setField(
    field: ResultField | null,
    component: string,
    limits: [number, number] | null,
    displacement: Float64Array | null,
    factor: number,
  ): void {
    this.resultField = field;
    this.resultValues = field ? scalarValues(field, component) : null;
    this.deformation = displacement;
    this.deformationFactor = factor;
    this.surface.material = field ? this.fieldMaterial : this.standardMaterial;
    if (this.resultValues) {
      const range = limits || fieldLimits(this.resultValues);
      this.fieldMaterial.uniforms.low.value = range[0];
      this.fieldMaterial.uniforms.high.value = range[1];
    }
    this.setView(this.view);
  }

  setSelected(triangle: number | null): void {
    this.selected = triangle;
    const geometry = new THREE.BufferGeometry();
    if (triangle !== null && this.rendered.includes(triangle)) {
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 1, 2].flatMap((local) => this.vertex(this.mesh.triangles[triangle * 3 + local])),
          3,
        ),
      );
    }
    this.replaceGeometry(this.highlight, geometry);
    this.highlight.visible = triangle !== null && this.rendered.includes(triangle);
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
    this.renderer.domElement.remove();
  }
}
