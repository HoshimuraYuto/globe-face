import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * FaceGlobeV15 — Add paper intersection visualization
 *
 * 2025-09-07 Updates (this revision):
 * - Added two red circular planes ("paper") intersecting the sphere.
 * - These planes are positioned to touch the sphere at 90°±15° and 270°±15°.
 * - The parts of the sphere outside of these planes are also colored red with cap geometries.
 * - This fulfills the user's request for visualizing specific intersecting planes and affected sphere areas.
 */

// ---------- Constants ----------
const RADIUS = 1.5;
const SURFACE_OFFSET = 1.0008; // line just above sphere surface
const SEGMENTS = 360; // 1 degree resolution
const GIZMO_SIZE = 112; // px overlay canvas

const COLORS = {
  bgLight: 0xfafafa,
  bgDark: 0x0a0a0a,
  sphereLight: 0xe5e5e5,
  sphereDark: 0x404040,
  gridLight: 0x404040,
  gridDark: 0xd4d4d4,
  axisY: 0x22c55e, // GREEN — Y
  equatorX: 0xd11a2a, // RED — X
  gizmoZ: 0x2563eb, // BLUE — Z
  faceMark: 0xd56b6b,
  gizmoFrameLight: 0x9ca3af,
  gizmoFrameDark: 0x6b7280,
  gizmoPlateLight: 0xffffff,
  gizmoPlateDark: 0x000000,
} as const;

// ---------- UI: Theme toggle ----------
function ThemeToggle({
  dark,
  onToggle,
}: {
  readonly dark: boolean;
  readonly onToggle: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(!dark)}
      aria-label="toggle theme"
      className={`relative inline-flex items-center justify-center w-14 h-8 rounded-full transition-colors duration-300 shadow ${
        dark ? "bg-neutral-800" : "bg-neutral-200"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`absolute left-1.5 w-5 h-5 transition-opacity ${
          dark ? "opacity-0" : "opacity-100"
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        className={`absolute right-1.5 w-5 h-5 transition-opacity ${
          dark ? "opacity-100" : "opacity-0"
        }`}
        fill="currentColor"
      >
        <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z" />
      </svg>
      <span
        className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform duration-300 ${
          dark ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ---------- Main Component ----------
export default function FaceGlobeV15() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // scene graph refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const globeRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const sphereMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const meridianMatsRef = useRef<THREE.LineBasicMaterial[]>([]);
  const eqMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const whiteDotMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const perpendicularMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const parallelLineMatRef = useRef<THREE.LineDashedMaterial | null>(null); // Refs for dynamic objects

  // Refs for dynamic objects
  const perpendicularLineRef = useRef<THREE.Line | null>(null);
  const arcPoint1Ref = useRef<THREE.Mesh | null>(null);
  const arcPoint2Ref = useRef<THREE.Mesh | null>(null);
  const divPoint1Ref = useRef<THREE.Mesh | null>(null);
  const divPoint2Ref = useRef<THREE.Mesh | null>(null);
  const halfPointRef = useRef<THREE.Mesh | null>(null);
  const quarterPointRef = useRef<THREE.Mesh | null>(null);
  const baseArcLengthRef = useRef(0);

  // Refs for dynamic objects related to contact angle
  const markersRef = useRef<THREE.Mesh[]>([]);
  const paperLeftRef = useRef<THREE.Mesh | null>(null);
  const paperRightRef = useRef<THREE.Mesh | null>(null);
  const capLeftRef = useRef<THREE.Mesh | null>(null);
  const capRightRef = useRef<THREE.Mesh | null>(null);
  const intersectionDotsRef = useRef<THREE.Mesh[]>([]);
  const intersectionLinesRef = useRef<THREE.Line[]>([]);
  const yzPaperRef = useRef<THREE.Mesh | null>(null);
  const yzIntersectionLineRef = useRef<THREE.Line | null>(null);
  const intersectionEquatorPointsRef = useRef<THREE.Mesh[]>([]);
  const parallelLinesRef = useRef<THREE.Line[]>([]); // OrbitControls

  // OrbitControls
  const controlsRef = useRef<OrbitControls | null>(null);

  // gizmo refs
  const axesRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const axesFrameMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const axesPlateMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

  // UI state
  const [stepDeg, setStepDeg] = useState(5);
  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<"object" | "world">("object");
  const [showBackEquator, setShowBackEquator] = useState(true);
  const [showBackMeridians, setShowBackMeridians] = useState(false);
  const [arcLengthScale, setArcLengthScale] = useState(100);
  const [arcStepPercent, setArcStepPercent] = useState(5);
  const [contactAngleDeg, setContactAngleDeg] = useState(33.56);
  const [contactAngleStep, setContactAngleStep] = useState(1);
  const [intersectionAngleDeg, setIntersectionAngleDeg] = useState(30);
  const [intersectionAngleStep, setIntersectionAngleStep] = useState(1);
  const gizmoModeRef = useRef<"object" | "world">(gizmoMode);
  useEffect(() => {
    gizmoModeRef.current = gizmoMode;
  }, [gizmoMode]);

  const defaultQuatRef = useRef(
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, -Math.PI / 2, 0, "XYZ")
    )
  );
  const camInitQuatRef = useRef(new THREE.Quaternion());

  // angle HUD
  const [angles, setAngles] = useState({ x: 0, y: 0, z: 0 });
  const anglesRef = useRef({ x: 0, y: 0, z: 0 });

  // init theme from OS
  useEffect(() => {
    const m =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)");
    setDark(typeof m === "object" && m.matches);
  }, []);

  // ---------- Scene Init (one-time) ----------
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    const width = container.clientWidth,
      height = container.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.2);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;
    camInitQuatRef.current.copy(camera.quaternion);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 4);
    scene.add(dir);

    const globe = new THREE.Group();
    globe.quaternion.copy(defaultQuatRef.current);
    scene.add(globe);
    globeRef.current = globe;

    // Sphere
    const sphereGeom = new THREE.SphereGeometry(RADIUS, 64, 64);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: COLORS.sphereLight,
      roughness: 0.95,
      metalness: 0,
    });
    sphereMatRef.current = sphereMat;
    globe.add(new THREE.Mesh(sphereGeom, sphereMat));

    const rSurface = RADIUS * SURFACE_OFFSET;

    // Spin axis (Y) — GREEN
    const axisColor = COLORS.axisY;
    // const axisTotal = RADIUS * 2.6;
    // const ext = (axisTotal - 2 * RADIUS) / 2;
    // const cap = (y0: number, y1: number) => {
    //   const g = new THREE.BufferGeometry().setFromPoints([
    //     new THREE.Vector3(0, y0, 0),
    //     new THREE.Vector3(0, y1, 0),
    //   ]);
    //   const m = new THREE.LineBasicMaterial({
    //     color: axisColor,
    //     transparent: true,
    //     opacity: 0.95,
    //   });
    //   const l = new THREE.Line(g, m);
    //   globe.add(l);
    //   return { g, m, l };
    // };
    // const capTop = cap(RADIUS, RADIUS + ext);
    // const capBot = cap(-RADIUS - ext, -RADIUS);

    const innerAxisGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -RADIUS, 0),
      new THREE.Vector3(0, RADIUS, 0),
    ]);
    const innerAxisDashMat = new THREE.LineDashedMaterial({
      color: axisColor,
      dashSize: 0.14,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const innerAxis = new THREE.Line(innerAxisGeom, innerAxisDashMat);
    innerAxis.computeLineDistances();
    innerAxis.renderOrder = 3;
    globe.add(innerAxis);

    // Poles + face mark
    const poleGeo = new THREE.SphereGeometry(RADIUS * 0.015, 16, 16);
    const poleMat = new THREE.MeshBasicMaterial({
      color: axisColor,
      depthTest: false,
    });
    const north = new THREE.Mesh(poleGeo, poleMat);
    north.position.set(0, RADIUS, 0);
    north.renderOrder = 6;
    const south = new THREE.Mesh(poleGeo, poleMat);
    south.position.set(0, -RADIUS, 0);
    south.renderOrder = 6;
    globe.add(north, south);
    const facePoint = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS * 0.015, 12, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.faceMark })
    );
    facePoint.position.set(RADIUS, 0, 0);
    facePoint.renderOrder = 4;
    globe.add(facePoint);

    // Meridians
    const meridianAngles = [0, Math.PI / 2];
    const makeMeridian = (phi: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < SEGMENTS; i++) {
        const t = (i / SEGMENTS) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            rSurface * Math.cos(phi) * Math.sin(t),
            rSurface * Math.cos(t),
            rSurface * Math.sin(phi) * Math.sin(t)
          )
        );
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: COLORS.gridLight,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      meridianMatsRef.current.push(mat);
      const loop = new THREE.LineLoop(geo, mat);
      loop.frustumCulled = false;
      loop.renderOrder = 2; // Add this line to fix visibility
      globe.add(loop);
    };
    meridianAngles.forEach(makeMeridian);

    // Equator (X = RED)
    const eqPts: THREE.Vector3[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2;
      eqPts.push(
        new THREE.Vector3(rSurface * Math.cos(t), 0, rSurface * Math.sin(t))
      );
    }
    const eqGeo = new THREE.BufferGeometry().setFromPoints(eqPts);
    const eqMat = new THREE.LineBasicMaterial({
      color: COLORS.equatorX,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    eqMatRef.current = eqMat;
    const equator = new THREE.LineLoop(eqGeo, eqMat);
    equator.frustumCulled = false;
    equator.renderOrder = 2;
    globe.add(equator);

    // Face arrow (X direction)
    const nLocal = new THREE.Vector3(1, 0, 0);
    const pLocal = new THREE.Vector3(RADIUS, 0, 0);
    const arrow = new THREE.ArrowHelper(
      nLocal.clone().normalize(),
      pLocal.clone().add(nLocal.clone().multiplyScalar(RADIUS * 0.02)),
      RADIUS * 0.56,
      COLORS.equatorX,
      RADIUS * 0.2,
      RADIUS * 0.1
    );
    arrow.renderOrder = 4;
    globe.add(arrow);

    // --- Dynamic objects based on contactAngleDeg (creation) ---
    // Red markers at 90°±contactAngleDeg and 270°±contactAngleDeg
    const markerGeo = new THREE.SphereGeometry(RADIUS * 0.01, 18, 18);
    const markerMat = new THREE.MeshBasicMaterial({ color: COLORS.equatorX });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(markerGeo.clone(), markerMat);
      m.renderOrder = 4;
      globe.add(m);
      markersRef.current.push(m);
    }

    // "Paper" planes
    const paperMat = new THREE.MeshBasicMaterial({
      color: COLORS.equatorX,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    paperLeftRef.current = new THREE.Mesh(new THREE.BufferGeometry(), paperMat);
    paperLeftRef.current.renderOrder = 5;
    globe.add(paperLeftRef.current);
    paperRightRef.current = new THREE.Mesh(
      new THREE.BufferGeometry(),
      paperMat
    );
    paperRightRef.current.renderOrder = 5;
    globe.add(paperRightRef.current);

    // Sphere caps
    const capMat = new THREE.MeshBasicMaterial({
      color: COLORS.equatorX,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    capLeftRef.current = new THREE.Mesh(new THREE.BufferGeometry(), capMat);
    capLeftRef.current.scale.setScalar(1.005);
    capLeftRef.current.quaternion.setFromAxisAngle(
      new THREE.Vector3(-1, 0, 0),
      Math.PI / 2
    );
    capLeftRef.current.renderOrder = 1;
    globe.add(capLeftRef.current);

    capRightRef.current = new THREE.Mesh(new THREE.BufferGeometry(), capMat);
    capRightRef.current.scale.setScalar(1.005);
    capRightRef.current.quaternion.setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2
    );
    capRightRef.current.renderOrder = 1;
    globe.add(capRightRef.current);

    // Intersection dots and lines
    const dotGeo = new THREE.SphereGeometry(RADIUS * 0.015, 16, 16);
    const redDotMat = new THREE.MeshBasicMaterial({
      color: COLORS.equatorX,
      depthTest: false,
    });
    const dashMat = new THREE.LineDashedMaterial({
      color: COLORS.equatorX,
      dashSize: 0.1,
      gapSize: 0.05,
      depthTest: false,
    });

    for (let i = 0; i < 10; i++) {
      const dot = new THREE.Mesh(dotGeo.clone(), redDotMat);
      dot.renderOrder = 6;
      globe.add(dot);
      intersectionDotsRef.current.push(dot);
    }

    const initialLinePoints = [new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < 4; i++) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(
        initialLinePoints
      );
      const line = new THREE.Line(lineGeo, dashMat);
      line.renderOrder = 5;
      globe.add(line);
      intersectionLinesRef.current.push(line);
    }

    // 90度/270度を結ぶ新しいZ軸を青色で追加
    const zAxisColor = COLORS.gizmoZ;
    // const zAxisTotal = RADIUS * 2.6;
    // const zExt = (zAxisTotal - 2 * RADIUS) / 2;

    // const capZ = (z0: number, z1: number) => {
    //   const g = new THREE.BufferGeometry().setFromPoints([
    //     new THREE.Vector3(0, 0, z0),
    //     new THREE.Vector3(0, 0, z1),
    //   ]);
    //   const m = new THREE.LineBasicMaterial({
    //     color: zAxisColor,
    //     transparent: true,
    //     opacity: 0.95,
    //   });
    //   const l = new THREE.Line(g, m);
    //   globe.add(l);
    //   return { g, m, l };
    // };
    // const capZPos = capZ(RADIUS, RADIUS + zExt);
    // const capZNeg = capZ(-RADIUS - zExt, -RADIUS);

    const innerAxisZGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -RADIUS),
      new THREE.Vector3(0, 0, RADIUS),
    ]);
    const innerAxisZDashMat = new THREE.LineDashedMaterial({
      color: zAxisColor,
      dashSize: 0.14,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const innerAxisZ = new THREE.Line(innerAxisZGeom, innerAxisZDashMat);
    innerAxisZ.computeLineDistances();
    innerAxisZ.renderOrder = 3;
    globe.add(innerAxisZ);

    const poleZGeo = new THREE.SphereGeometry(RADIUS * 0.015, 16, 16);
    const poleZMat = new THREE.MeshBasicMaterial({
      color: 0xff00ff, // Magenta, a mix of red and blue
      depthTest: false,
    });
    const poleZPos = new THREE.Mesh(poleZGeo, poleZMat);
    poleZPos.position.set(0, 0, RADIUS);
    poleZPos.renderOrder = 6;
    const poleZNeg = new THREE.Mesh(poleZGeo, poleZMat);
    poleZNeg.position.set(0, 0, -RADIUS);
    poleZNeg.renderOrder = 6;
    globe.add(poleZPos, poleZNeg);

    // --- 0度/180度を結ぶX軸を追加 ---
    const xAxisColor = COLORS.equatorX;
    // const xAxisTotal = RADIUS * 2.6;
    // const xExt = (xAxisTotal - 2 * RADIUS) / 2;

    // const capX = (x0: number, x1: number) => {
    //   const g = new THREE.BufferGeometry().setFromPoints([
    //     new THREE.Vector3(x0, 0, 0),
    //     new THREE.Vector3(x1, 0, 0),
    //   ]);
    //   const m = new THREE.LineBasicMaterial({
    //     color: xAxisColor,
    //     transparent: true,
    //     opacity: 0.95,
    //   });
    //   const l = new THREE.Line(g, m);
    //   globe.add(l);
    //   return { g, m, l };
    // };
    // const capXPos = capX(RADIUS, RADIUS + xExt);
    // const capXNeg = capX(-RADIUS - xExt, -RADIUS);

    const innerAxisXGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-RADIUS, 0, 0),
      new THREE.Vector3(RADIUS, 0, 0),
    ]);
    const innerAxisXDashMat = new THREE.LineDashedMaterial({
      color: xAxisColor,
      dashSize: 0.14,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const innerAxisX = new THREE.Line(innerAxisXGeom, innerAxisXDashMat);
    innerAxisX.computeLineDistances();
    innerAxisX.renderOrder = 3;
    globe.add(innerAxisX);

    // X軸の極 (0度はfacePointがあるので180度側のみ追加)
    const poleXGeo = new THREE.SphereGeometry(RADIUS * 0.015, 16, 16);
    const poleXMat = new THREE.MeshBasicMaterial({
      color: xAxisColor,
      depthTest: false,
    });
    const poleXNeg = new THREE.Mesh(poleXGeo, poleXMat);
    poleXNeg.position.set(-RADIUS, 0, 0);
    poleXNeg.renderOrder = 6;
    globe.add(poleXNeg);
    // --- ここまで追加 ---

    // --- 北極点と矢印の間に点を追加 ---
    const whiteDotGeo = new THREE.SphereGeometry(RADIUS * 0.015, 16, 16);
    const whiteDotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
    });
    whiteDotMatRef.current = whiteDotMat;
    const angleFromNorthPole = THREE.MathUtils.degToRad(45);
    const dotX = RADIUS * Math.sin(angleFromNorthPole);
    const dotY = RADIUS * Math.cos(angleFromNorthPole);

    const fortyFiveDegreeDot = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    fortyFiveDegreeDot.position.set(dotX, dotY, 0);
    fortyFiveDegreeDot.renderOrder = 6;
    globe.add(fortyFiveDegreeDot);
    // --- ここまで追加 ---

    // --- 矢印からの垂線を延長 ---
    baseArcLengthRef.current = RADIUS * angleFromNorthPole;
    const perpendicularLineColor = 0xffffff; // White

    const perpendicularGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(RADIUS, 0, 0),
      new THREE.Vector3(RADIUS, -baseArcLengthRef.current * 2, 0),
    ]);
    const perpendicularMat = new THREE.LineBasicMaterial({
      color: perpendicularLineColor,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    perpendicularMatRef.current = perpendicularMat;
    const perpendicularLine = new THREE.Line(
      perpendicularGeom,
      perpendicularMat
    );
    perpendicularLine.renderOrder = 3;
    perpendicularLineRef.current = perpendicularLine;
    globe.add(perpendicularLine);
    // --- ここまで追加 ---

    // --- 延長した線の上に点を復活 ---
    arcPoint1Ref.current = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    arcPoint1Ref.current.position.set(RADIUS, -baseArcLengthRef.current, 0);
    arcPoint1Ref.current.renderOrder = 6;
    globe.add(arcPoint1Ref.current);

    arcPoint2Ref.current = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    arcPoint2Ref.current.position.set(RADIUS, -baseArcLengthRef.current * 2, 0);
    arcPoint2Ref.current.renderOrder = 6;
    globe.add(arcPoint2Ref.current);
    // --- ここまで追加 ---

    // --- さらに線上に点を分割して追加 ---
    divPoint1Ref.current = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    divPoint1Ref.current.position.set(
      RADIUS,
      -baseArcLengthRef.current - baseArcLengthRef.current / 3,
      0
    );
    divPoint1Ref.current.renderOrder = 6;
    globe.add(divPoint1Ref.current);

    divPoint2Ref.current = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    divPoint2Ref.current.position.set(
      RADIUS,
      -baseArcLengthRef.current - (2 * baseArcLengthRef.current) / 3,
      0
    );
    divPoint2Ref.current.renderOrder = 6;
    globe.add(divPoint2Ref.current);

    halfPointRef.current = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    halfPointRef.current.position.set(RADIUS, -baseArcLengthRef.current / 2, 0);
    halfPointRef.current.renderOrder = 6;
    globe.add(halfPointRef.current);

    quarterPointRef.current = new THREE.Mesh(whiteDotGeo, whiteDotMat);
    quarterPointRef.current.position.set(
      RADIUS,
      -baseArcLengthRef.current / 4,
      0
    );
    quarterPointRef.current.renderOrder = 6;
    globe.add(quarterPointRef.current);
    // --- ここまで追加 ---

    const yzPaperGeo = new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2);
    const yzPaperMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2,
      depthTest: false,
    });
    const yzPaper = new THREE.Mesh(yzPaperGeo, yzPaperMat);
    yzPaper.rotation.y = Math.PI / 2; // YZ平面と平行になるように回転
    yzPaper.visible = false;
    yzPaper.renderOrder = 0;
    globe.add(yzPaper);
    yzPaperRef.current = yzPaper;

    const yzIntersectionLineMat = new THREE.LineDashedMaterial({
      color: 0xffffff,
      dashSize: 0.08,
      gapSize: 0.04,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const yzIntersectionLineGeo = new THREE.BufferGeometry();
    const yzIntersectionLine = new THREE.Line(
      yzIntersectionLineGeo,
      yzIntersectionLineMat
    );
    yzIntersectionLine.renderOrder = 5;
    globe.add(yzIntersectionLine);
    yzIntersectionLineRef.current = yzIntersectionLine; // 交点と平行線のオブジェクトを初期化

    for (let i = 0; i < 2; i++) {
      const point = new THREE.Mesh(whiteDotGeo.clone(), whiteDotMat);
      point.renderOrder = 7;
      globe.add(point);
      intersectionEquatorPointsRef.current.push(point);
    }

    const parallelLineMat = new THREE.LineDashedMaterial({
      color: 0xffffff,
      dashSize: 0.08,
      gapSize: 0.04,
      depthTest: false,
    });
    parallelLineMatRef.current = parallelLineMat;

    for (let i = 0; i < 2; i++) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]);
      const line = new THREE.Line(lineGeo, parallelLineMat);
      line.renderOrder = 4;
      globe.add(line);
      parallelLinesRef.current.push(line);
    }

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = RADIUS * 2.2;
    controls.maxDistance = RADIUS * 8;
    controls.saveState(); // save initial camera/target/zoom
    controlsRef.current = controls;

    // Theme (init)
    const applyTheme = (isDark: boolean) => {
      scene.background = new THREE.Color(
        isDark ? COLORS.bgDark : COLORS.bgLight
      );
      sphereMat.color.set(isDark ? COLORS.sphereDark : COLORS.sphereLight);
      meridianMatsRef.current.forEach((m) =>
        m.color.set(isDark ? COLORS.gridDark : COLORS.gridLight)
      );
      if (axesFrameMatRef.current)
        axesFrameMatRef.current.color.set(
          isDark ? COLORS.gizmoFrameDark : COLORS.gizmoFrameLight
        );
      if (axesPlateMatRef.current) {
        axesPlateMatRef.current.color.set(
          isDark ? COLORS.gizmoPlateDark : COLORS.gizmoPlateLight
        );
        axesPlateMatRef.current.opacity = isDark ? 0.35 : 0.25;
        axesPlateMatRef.current.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };

    // ---------- Axes Gizmo (overlay) ----------
    const axesScene = new THREE.Scene();
    const axesCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    axesCamera.position.set(0, 0, 2);
    axesCamera.lookAt(0, 0, 0);
    const axesRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    axesRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    axesRenderer.setSize(GIZMO_SIZE, GIZMO_SIZE);
    axesRenderer.setClearColor(0x000000, 0);
    axesRendererRef.current = axesRenderer;
    const canvas = axesRenderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.right = "8px";
    canvas.style.bottom = "8px";
    canvas.style.width = `${GIZMO_SIZE}px`;
    canvas.style.height = `${GIZMO_SIZE}px`;
    canvas.style.pointerEvents = "none";
    canvas.style.userSelect = "none";
    container.appendChild(canvas);

    const axesRoot = new THREE.Group();
    axesScene.add(axesRoot);
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(0.96, 48),
      new THREE.MeshBasicMaterial({
        color: COLORS.gizmoPlateLight,
        transparent: true,
        opacity: 0.26,
      })
    );
    axesPlateMatRef.current = plate.material as THREE.MeshBasicMaterial;
    plate.position.set(0, 0, -0.01);
    axesRoot.add(plate);
    const ringPts: THREE.Vector3[] = [];
    const RING_R = 0.92;
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      ringPts.push(
        new THREE.Vector3(Math.cos(t) * RING_R, Math.sin(t) * RING_R, 0)
      );
    }
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({
        color: COLORS.gizmoFrameLight,
        transparent: true,
        opacity: 0.7,
      })
    );
    axesFrameMatRef.current = ring.material as THREE.LineBasicMaterial;
    axesRoot.add(ring);

    // Arrows (X=red, Y=green, Z=blue)
    const axisGroup = new THREE.Group();
    axesRoot.add(axisGroup);
    const makeArrow = (dir: THREE.Vector3, hex: number) => {
      const g = new THREE.Group();
      const shaftH = 0.78,
        shaftR = 0.045,
        headH = 0.24,
        headR = 0.11;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(shaftR, shaftR, shaftH, 18),
        new THREE.MeshBasicMaterial({ color: hex })
      );
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(headR, headH, 22),
        new THREE.MeshBasicMaterial({ color: hex })
      );
      shaft.position.set(0, shaftH / 2, 0);
      head.position.set(0, shaftH + headH / 2, 0);
      g.add(shaft, head);
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize()
      );
      g.quaternion.copy(q);
      return g;
    };
    const xArrow = makeArrow(new THREE.Vector3(1, 0, 0), COLORS.equatorX);
    const yArrow = makeArrow(new THREE.Vector3(0, 1, 0), COLORS.axisY);
    const zArrow = makeArrow(new THREE.Vector3(0, 0, 1), COLORS.gizmoZ);
    axisGroup.add(xArrow, yArrow, zArrow);

    // Helpers for HUD angle computation
    const tmpEuler = new THREE.Euler();
    const qVO0 = new THREE.Quaternion(); // camera-space zero (initial)
    const qVOcur = new THREE.Quaternion();
    const qRel = new THREE.Quaternion();
    qVO0.copy(camInitQuatRef.current).invert().multiply(defaultQuatRef.current);

    const wrapDeg = (d: number) => {
      const r = ((((d + 180) % 360) + 360) % 360) - 180; // [-180,180)
      return r;
    };

    // Start loop
    const qTarget = new THREE.Quaternion();
    let lastHUD = 0;
    const applyAndStart = (isDark: boolean) => {
      applyTheme(isDark);
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera); // gizmo orientation: camera^-1 * (globe or I)
        if (gizmoModeRef.current === "object") {
          qTarget.copy(camera.quaternion).invert().multiply(globe.quaternion);
        } else {
          qTarget.copy(camera.quaternion).invert();
        }
        axesRoot.quaternion.copy(qTarget);
        axesRenderer.render(axesScene, axesCamera);

        // HUD angles — update on drag as well
        const now = performance.now();
        if (now - lastHUD > 60) {
          // ~16fps cap
          if (gizmoModeRef.current === "object") {
            // camera-space: (cam^-1 * globe) relative to initial (cam0^-1 * globe0)
            qVOcur.copy(camera.quaternion).invert().multiply(globe.quaternion);
            qRel.copy(qVO0).invert().multiply(qVOcur);
          } else {
            // world-space: relative to default (globe0)
            qRel
              .copy(defaultQuatRef.current)
              .invert()
              .multiply(globe.quaternion);
          }
          tmpEuler.setFromQuaternion(qRel, "XYZ");
          const ax = wrapDeg(THREE.MathUtils.radToDeg(tmpEuler.x));
          const ay = wrapDeg(THREE.MathUtils.radToDeg(tmpEuler.y));
          const az = wrapDeg(THREE.MathUtils.radToDeg(tmpEuler.z));
          const prev = anglesRef.current;
          if (
            Math.abs(prev.x - ax) > 0.1 ||
            Math.abs(prev.y - ay) > 0.1 ||
            Math.abs(prev.z - az) > 0.1
          ) {
            const next = { x: ax, y: ay, z: az };
            anglesRef.current = next;
            setAngles(next);
          }
          lastHUD = now;
        }
      });
    };
    applyAndStart(false);
    applyAndStart(
      !!(
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)") &&
        dark
      )
    );

    const onResize = () => {
      const w = container.clientWidth,
        h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      renderer.setAnimationLoop(null);
      // Clean up Three.js objects
      const cleanUp = (obj: any) => {
        if (!obj) return;
        if (obj.geometry) {
          obj.geometry.dispose();
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: THREE.Material) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
        if (obj.children) {
          [...obj.children].forEach(cleanUp);
        }
      };

      if (sceneRef.current) {
        cleanUp(sceneRef.current);
      }
      if (axesRendererRef.current) {
        cleanUp(axesScene);
        axesRendererRef.current.dispose();
      }
      renderer.dispose();

      if (renderer.domElement?.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      if (axesRendererRef.current?.domElement?.parentNode === container) {
        container.removeChild(axesRendererRef.current.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme toggle effect
  useEffect(() => {
    if (!sphereMatRef.current || !sceneRef.current) return;
    const isDark = dark;
    sceneRef.current.background = new THREE.Color(
      isDark ? COLORS.bgDark : COLORS.bgLight
    );
    sphereMatRef.current.color.set(
      isDark ? COLORS.sphereDark : COLORS.sphereLight
    );
    meridianMatsRef.current.forEach((m) =>
      m.color.set(isDark ? COLORS.gridDark : COLORS.gridLight)
    );
    if (axesFrameMatRef.current)
      axesFrameMatRef.current.color.set(
        isDark ? COLORS.gizmoFrameDark : COLORS.gizmoFrameLight
      );
    if (axesPlateMatRef.current) {
      axesPlateMatRef.current.color.set(
        isDark ? COLORS.gizmoPlateDark : COLORS.gizmoPlateLight
      );
      axesPlateMatRef.current.opacity = isDark ? 0.35 : 0.25;
      axesPlateMatRef.current.needsUpdate = true;
    }
    if (whiteDotMatRef.current) {
      whiteDotMatRef.current.color.set(isDark ? 0xffffff : COLORS.gridLight);
    }
    if (perpendicularMatRef.current) {
      perpendicularMatRef.current.color.set(
        isDark ? 0xffffff : COLORS.gridLight
      );
    }
    // Sync page background/text with theme to avoid white below canvas
    if (parallelLineMatRef.current) {
      parallelLineMatRef.current.color.set(
        isDark ? 0xffffff : COLORS.gridLight
      );
    }
    const body = document.body;
    body.classList.add("min-h-screen", "antialiased");
    body.classList.remove(
      "bg-neutral-50",
      "text-neutral-900",
      "bg-neutral-950",
      "text-neutral-100"
    );
    if (isDark) {
      body.classList.add("bg-neutral-950", "text-neutral-100");
    } else {
      body.classList.add("bg-neutral-50", "text-neutral-900");
    }
  }, [dark]);

  useEffect(() => {
    const isDark = dark;
    if (yzIntersectionLineRef.current) {
      (
        yzIntersectionLineRef.current.material as THREE.LineDashedMaterial
      ).color.set(isDark ? 0xffffff : COLORS.gridLight);
    }
    if (yzPaperRef.current) {
      (yzPaperRef.current.material as THREE.MeshBasicMaterial).color.set(
        isDark ? 0xffffff : 0x404040
      );
    }
  }, [dark]);

  useEffect(() => {
    const eqMat = eqMatRef.current;
    if (!eqMat) return;

    const newDepthTest = !showBackEquator;
    eqMat.depthTest = newDepthTest;
    eqMat.depthWrite = newDepthTest;
    eqMat.needsUpdate = true;
  }, [showBackEquator]);

  useEffect(() => {
    const meridianMats = meridianMatsRef.current;
    if (meridianMats.length === 0) return;

    const newDepthTest = !showBackMeridians;
    meridianMats.forEach((mat) => {
      mat.depthTest = newDepthTest;
      mat.depthWrite = newDepthTest;
      mat.needsUpdate = true;
    });
  }, [showBackMeridians]);

  useEffect(() => {
    if (
      !perpendicularLineRef.current ||
      !arcPoint1Ref.current ||
      !arcPoint2Ref.current ||
      !divPoint1Ref.current ||
      !divPoint2Ref.current ||
      !halfPointRef.current ||
      !quarterPointRef.current
    ) {
      return;
    }

    const baseArcLength = baseArcLengthRef.current;
    const scaledArcLength = baseArcLength * (arcLengthScale / 100);

    // Update dot positions
    arcPoint1Ref.current.position.y = -scaledArcLength;
    arcPoint2Ref.current.position.y = -scaledArcLength * 2;
    divPoint1Ref.current.position.y = -scaledArcLength - scaledArcLength / 3;
    divPoint2Ref.current.position.y =
      -scaledArcLength - (2 * scaledArcLength) / 3;
    halfPointRef.current.position.y = -scaledArcLength / 2;
    quarterPointRef.current.position.y = -scaledArcLength / 4;

    // Update line geometry
    const line = perpendicularLineRef.current;
    const positions = line.geometry.attributes.position;
    positions.setY(1, -scaledArcLength * 2);
    positions.needsUpdate = true;
  }, [arcLengthScale]);

  useEffect(() => {
    // This effect updates scene objects when contactAngleDeg changes.
    if (
      markersRef.current.length === 0 ||
      !paperLeftRef.current ||
      !paperRightRef.current ||
      !capLeftRef.current ||
      !capRightRef.current ||
      intersectionDotsRef.current.length === 0 ||
      intersectionLinesRef.current.length === 0
    ) {
      return;
    }

    // 1. Recalculate geometric parameters
    const angleRad = THREE.MathUtils.degToRad(90 - contactAngleDeg);
    const planeZ = RADIUS * Math.sin(angleRad);
    const intersectionRadius = RADIUS * Math.cos(angleRad);

    // 2. Update markers on the equator
    const newMarkerAngles = [
      90 - contactAngleDeg,
      90 + contactAngleDeg,
      270 - contactAngleDeg,
      270 + contactAngleDeg,
    ];
    markersRef.current.forEach((marker, i) => {
      const t = THREE.MathUtils.degToRad(newMarkerAngles[i]);
      marker.position.set(RADIUS * Math.cos(t), 0, RADIUS * Math.sin(t));
    });

    // 3. Update "paper" planes
    if (paperLeftRef.current) {
      paperLeftRef.current.geometry.dispose();
      paperLeftRef.current.geometry = new THREE.CircleGeometry(
        intersectionRadius,
        64
      );
      paperLeftRef.current.position.z = -planeZ;
    }
    if (paperRightRef.current) {
      paperRightRef.current.geometry.dispose();
      paperRightRef.current.geometry = new THREE.CircleGeometry(
        intersectionRadius,
        64
      );
      paperRightRef.current.position.z = planeZ;
    }

    // 4. Update sphere caps
    const capAngle = Math.PI / 2 - angleRad;
    if (capLeftRef.current) {
      capLeftRef.current.geometry.dispose();
      capLeftRef.current.geometry = new THREE.SphereGeometry(
        RADIUS,
        64,
        32,
        0,
        Math.PI * 2,
        0,
        capAngle
      );
    }
    if (capRightRef.current) {
      capRightRef.current.geometry.dispose();
      capRightRef.current.geometry = new THREE.SphereGeometry(
        RADIUS,
        64,
        32,
        0,
        Math.PI * 2,
        0,
        capAngle
      );
    }

    // 5. Update intersection dots and lines
    let dotIndex = 0;
    let lineIndex = 0;
    [planeZ, -planeZ].forEach((z) => {
      const positions = {
        meridianTop: new THREE.Vector3(0, intersectionRadius, z),
        meridianBottom: new THREE.Vector3(0, -intersectionRadius, z),
        equatorRight: new THREE.Vector3(intersectionRadius, 0, z),
        equatorLeft: new THREE.Vector3(-intersectionRadius, 0, z),
        center: new THREE.Vector3(0, 0, z),
      };

      // Dots
      intersectionDotsRef.current[dotIndex++].position.copy(
        positions.meridianTop
      );
      intersectionDotsRef.current[dotIndex++].position.copy(
        positions.meridianBottom
      );
      intersectionDotsRef.current[dotIndex++].position.copy(
        positions.equatorRight
      );
      intersectionDotsRef.current[dotIndex++].position.copy(
        positions.equatorLeft
      );
      intersectionDotsRef.current[dotIndex++].position.copy(positions.center);

      // Lines
      const meridianLine = intersectionLinesRef.current[lineIndex++];
      const meridianPositions = meridianLine.geometry.attributes.position;
      meridianPositions.setXYZ(
        0,
        positions.meridianTop.x,
        positions.meridianTop.y,
        positions.meridianTop.z
      );
      meridianPositions.setXYZ(
        1,
        positions.meridianBottom.x,
        positions.meridianBottom.y,
        positions.meridianBottom.z
      );
      meridianPositions.needsUpdate = true;
      meridianLine.computeLineDistances();

      const equatorLine = intersectionLinesRef.current[lineIndex++];
      const equatorPositions = equatorLine.geometry.attributes.position;
      equatorPositions.setXYZ(
        0,
        positions.equatorRight.x,
        positions.equatorRight.y,
        positions.equatorRight.z
      );
      equatorPositions.setXYZ(
        1,
        positions.equatorLeft.x,
        positions.equatorLeft.y,
        positions.equatorLeft.z
      );
      equatorPositions.needsUpdate = true;
      equatorLine.computeLineDistances();
    });
  }, [contactAngleDeg]);

  // ---------- Actions ----------
  // Quaternion-based local rotations (right-hand rule)
  useEffect(() => {
    if (
      !yzPaperRef.current ||
      !yzIntersectionLineRef.current ||
      intersectionEquatorPointsRef.current.length === 0 ||
      parallelLinesRef.current.length === 0
    ) {
      return;
    }

    const angleRad = THREE.MathUtils.degToRad(intersectionAngleDeg);
    const lineRadius = RADIUS * SURFACE_OFFSET; // 1. X軸に沿った平面のオフセットを計算 (0deg at Y-axis -> x=0, 90deg at X-axis -> x=R)

    const planeX = lineRadius * Math.sin(angleRad); // 2. 交差する円の半径を計算

    const intersectionRadius = lineRadius * Math.cos(angleRad); // 3. (非表示の) 平面オブジェクトの位置を更新

    if (yzPaperRef.current) {
      yzPaperRef.current.position.x = RADIUS * Math.sin(angleRad);
    } // 4. 交線のジオメトリを更新

    if (yzIntersectionLineRef.current) {
      const line = yzIntersectionLineRef.current;
      const pts: THREE.Vector3[] = []; // x = planeX 平面上に上半分の円（弧）を描画

      for (let i = 0; i <= SEGMENTS / 2; i++) {
        const t = (i / (SEGMENTS / 2) - 0.5) * Math.PI; // -PI/2 to PI/2
        const y = intersectionRadius * Math.cos(t);
        const z = intersectionRadius * Math.sin(t);
        pts.push(new THREE.Vector3(planeX, y, z));
      }

      if (line.geometry) {
        line.geometry.dispose();
      }
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      line.computeLineDistances();
    } // 5. 赤道との交点と平行線を更新

    const pointZ = intersectionRadius; // 交点

    intersectionEquatorPointsRef.current[0].position.set(planeX, 0, pointZ);
    intersectionEquatorPointsRef.current[1].position.set(planeX, 0, -pointZ); // 下半分の平行線

    const intersectionPointsZ = [pointZ, -pointZ];
    intersectionPointsZ.forEach((z, index) => {
      const line = parallelLinesRef.current[index];
      const start = new THREE.Vector3(planeX, 0, z);
      const endDown = new THREE.Vector3(planeX, -RADIUS, z);

      const positions = line.geometry.attributes.position;
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, endDown.x, endDown.y, endDown.z);
      positions.needsUpdate = true;
      line.computeLineDistances();
    });
  }, [intersectionAngleDeg]);

  const rotateBy = (axis: "x" | "y" | "z", sign: 1 | -1) => {
    const g = globeRef.current;
    if (!g) return;
    const rad = THREE.MathUtils.degToRad(stepDeg) * sign;
    let v: THREE.Vector3;
    if (axis === "x") {
      v = new THREE.Vector3(1, 0, 0);
    } else if (axis === "y") {
      v = new THREE.Vector3(0, 1, 0);
    } else {
      v = new THREE.Vector3(0, 0, 1);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(v, rad);
    g.quaternion.multiply(q); // local rotation
  };

  const changeArcLength = (sign: 1 | -1) => {
    setArcLengthScale((prev) => {
      const next = prev + arcStepPercent * sign;
      return Math.max(0, Math.min(200, next));
    });
  };

  const changeContactAngle = (sign: 1 | -1) => {
    setContactAngleDeg((prev) => {
      const next = prev + contactAngleStep * sign;
      return Math.max(0.1, Math.min(89.9, next));
    });
  };

  // uniform random orientation with front-facing constraint
  const changeIntersectionAngle = (sign: 1 | -1) => {
    setIntersectionAngleDeg((prev) => {
      const next = prev + intersectionAngleStep * sign;
      return Math.max(0, Math.min(90, next));
    });
  };

  const randomFrontRotation = () => {
    const g = globeRef.current,
      cam = cameraRef.current;
    if (!g || !cam) return;
    const normalLocal = new THREE.Vector3(1, 0, 0); // face direction in local
    const qDefault = new THREE.Quaternion().copy(defaultQuatRef.current);
    const qAxis = new THREE.Quaternion();
    const axis = new THREE.Vector3();

    for (let k = 0; k < 400; k++) {
      const u = Math.random() * 2 - 1; // cos(theta)
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      axis.set(s * Math.cos(phi), s * Math.sin(phi), u).normalize();
      const angle = Math.random() * Math.PI * 2; // 0..360°
      qAxis.setFromAxisAngle(axis, angle);

      const qCand = qDefault.clone().multiply(qAxis);
      const nWorld = normalLocal.clone().applyQuaternion(qCand);
      const pWorld = nWorld.clone().multiplyScalar(RADIUS);
      const toCam = cam.position.clone().sub(pWorld).normalize();
      if (nWorld.dot(toCam) > 0.2) {
        g.quaternion.copy(qCand);
        g.updateMatrixWorld(true);
        return;
      }
    }
    // if not found (rare), no change
  };

  // reset to initialized orientation + camera
  const resetOrientation = () => {
    const g = globeRef.current;
    const controls = controlsRef.current;
    if (g) {
      g.quaternion.copy(defaultQuatRef.current);
      g.updateMatrixWorld(true);
    }
    if (controls) {
      controls.reset(); // restores camera position/target/zoom
      controls.update();
    }
  };

  const resetAll = () => {
    resetOrientation();
    setArcLengthScale(100);
    setContactAngleDeg(33.56);
    setIntersectionAngleDeg(30);
  };

  // ---------- UI ----------
  let panelClass = "";
  if (collapsed) {
    panelClass = "absolute top-3 right-3";
  } else if (dark) {
    panelClass =
      "absolute top-3 right-3 bg-neutral-900/80 text-neutral-100 backdrop-blur px-3 py-3 rounded-xl text-sm leading-5 shadow space-y-2";
  } else {
    panelClass =
      "absolute top-3 right-3 bg-neutral-50/90 text-neutral-800 backdrop-blur px-3 py-3 rounded-xl text-sm leading-5 shadow space-y-2";
  }
  const subtleText = dark ? "text-neutral-300" : "text-neutral-600";
  const noteText = dark ? "text-neutral-200" : "text-neutral-700";
  const btn = (d: boolean) =>
    d
      ? "px-2 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700"
      : "px-2 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200";
  const chip = (d: boolean) =>
    d
      ? "px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
      : "px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200";

  return (
    <div className="w-full h-screen relative">
      <div
        ref={mountRef}
        className="absolute inset-0 rounded-2xl overflow-hidden shadow-lg"
      />

      {/* theme toggle + gizmo mode */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <ThemeToggle dark={dark} onToggle={setDark} />
        <span className={`text-xs ${subtleText}`}>
          {dark ? "Dark (neutral)" : "Light (neutral)"}
        </span>
        <div className="ml-2 flex items-center gap-1 text-xs">
          <span className={`${subtleText}`}>Gizmo</span>
          <button
            onClick={() =>
              setGizmoMode(gizmoMode === "object" ? "world" : "object")
            }
            className={`px-2 py-1 rounded ${
              dark
                ? "bg-neutral-800 hover:bg-neutral-700 text-neutral-100"
                : "bg-neutral-100 hover:bg-neutral-200 text-neutral-900"
            }`}
            title="Toggle gizmo mode (Object/World)"
          >
            {gizmoMode === "object" ? "Object" : "World"}
          </button>
        </div>
      </div>

      {/* control panel */}
      <div className={panelClass}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`rounded-full shadow ${
            dark
              ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
              : "bg-white text-neutral-800 hover:bg-neutral-100"
          } ${collapsed ? "p-2" : "p-1 absolute -top-3 -right-3"}`}
          title={collapsed ? "expand" : "collapse"}
          aria-label={collapsed ? "expand" : "collapse"}
        >
          {collapsed ? "▣" : "—"}
        </button>

        {!collapsed && (
          <>
            <div className="font-medium">操作</div>
            <div className="my-2 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  id="show-back-equator"
                  checked={showBackEquator}
                  onChange={(e) => setShowBackEquator(e.target.checked)}
                  className={`form-checkbox h-3.5 w-3.5 rounded-sm appearance-none ${
                    dark
                      ? "bg-neutral-800 border-neutral-600 checked:bg-blue-500"
                      : "bg-neutral-200 border-neutral-400 checked:bg-blue-600"
                  } border checked:border-transparent focus:outline-none`}
                />
                <label htmlFor="show-back-equator" className={`${subtleText}`}>
                  裏側の赤道を表示
                </label>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  id="show-back-meridians"
                  checked={showBackMeridians}
                  onChange={(e) => setShowBackMeridians(e.target.checked)}
                  className={`form-checkbox h-3.5 w-3.5 rounded-sm appearance-none ${
                    dark
                      ? "bg-neutral-800 border-neutral-600 checked:bg-blue-500"
                      : "bg-neutral-200 border-neutral-400 checked:bg-blue-600"
                  } border checked:border-transparent focus:outline-none`}
                />
                <label
                  htmlFor="show-back-meridians"
                  className={`${subtleText}`}
                >
                  裏側の経線を表示
                </label>
              </div>
            </div>
            <ul className={`list-disc pl-4 text-xs ${noteText}`}>
              <li>ドラッグ: 自由回転(360°)</li>
              <li>ホイール: ズーム</li>
            </ul>
            {/* Angle HUD */}
            <div className={`mt-2 text-xs ${subtleText} font-mono`}>
              <div className="flex items-center gap-3">
                <span>
                  角度 (
                  {gizmoMode === "object" ? "Object基準(視点)" : "World基準"})
                </span>
                <span>X: {angles.x.toFixed(1)}°</span>
                <span>Y: {angles.y.toFixed(1)}°</span>
                <span>Z: {angles.z.toFixed(1)}°</span>
              </div>
            </div>
            <div className="border-t border-neutral-800/30 pt-2 mt-2">
              <div className="flex justify-between items-center mb-1">
                <div className={`text-xs ${subtleText}`}>垂線の長さ (%)</div>
                <button
                  onClick={() => setArcLengthScale(100)}
                  className={chip(dark)}
                  title="垂線の長さを100%に戻す"
                >
                  リセット
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={arcStepPercent}
                  min={1}
                  step={1}
                  onChange={(e) =>
                    setArcStepPercent(
                      Math.max(1, parseInt(e.target.value) || 1)
                    )
                  }
                  className={`w-20 border rounded px-2 py-1 text-right ${
                    dark
                      ? "bg-neutral-900 border-neutral-700 text-neutral-100"
                      : "bg-white border-neutral-300"
                  }`}
                  title="1クリックあたりの長さ変化率(%)"
                />
                <div className="flex gap-1">
                  {[1, 5, 15].map((v) => (
                    <button
                      key={v}
                      onClick={() => setArcStepPercent(v)}
                      className={chip(dark)}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <button
                  onClick={() => changeArcLength(-1)}
                  className={btn(dark)}
                >
                  −
                </button>
                <div
                  className={`flex items-center justify-center ${subtleText} font-mono`}
                >
                  {arcLengthScale}%
                </div>
                <button
                  onClick={() => changeArcLength(1)}
                  className={btn(dark)}
                >
                  ＋
                </button>
              </div>
            </div>
            <div className="border-t border-neutral-800/30 pt-2 mt-2">
              <div className="flex justify-between items-center mb-1">
                <div className={`text-xs ${subtleText}`}>紙の角度 (度)</div>
                <button
                  onClick={() => setContactAngleDeg(33.56)}
                  className={chip(dark)}
                  title="紙の角度を33.56°に戻す"
                >
                  リセット
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={contactAngleStep}
                  min={0.1}
                  step={0.1}
                  onChange={(e) =>
                    setContactAngleStep(
                      Math.max(0.1, parseFloat(e.target.value) || 0.1)
                    )
                  }
                  className={`w-20 border rounded px-2 py-1 text-right ${
                    dark
                      ? "bg-neutral-900 border-neutral-700 text-neutral-100"
                      : "bg-white border-neutral-300"
                  }`}
                  title="1クリックあたりの角度変化(度)"
                />
                <div className="flex gap-1">
                  {[1, 5, 15].map((v) => (
                    <button
                      key={v}
                      onClick={() => setContactAngleStep(v)}
                      className={chip(dark)}
                    >
                      {v}°
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <button
                  onClick={() => changeContactAngle(-1)}
                  className={btn(dark)}
                >
                  −
                </button>
                <div
                  className={`flex items-center justify-center ${subtleText} font-mono`}
                >
                  {contactAngleDeg.toFixed(2)}°
                </div>
                <button
                  onClick={() => changeContactAngle(1)}
                  className={btn(dark)}
                >
                  ＋
                </button>
              </div>
            </div>
            <div className="border-t border-neutral-800/30 pt-2 mt-2">
              <div className="flex justify-between items-center mb-1">
                <div className={`text-xs ${subtleText}`}>交線の角度 (度)</div>
                <button
                  onClick={() => setIntersectionAngleDeg(30)}
                  className={chip(dark)}
                  title="交線の角度を30°に戻す"
                >
                  リセット
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={intersectionAngleStep}
                  min={0.1}
                  step={0.1}
                  onChange={(e) =>
                    setIntersectionAngleStep(
                      Math.max(0.1, parseFloat(e.target.value) || 0.1)
                    )
                  }
                  className={`w-20 border rounded px-2 py-1 text-right ${
                    dark
                      ? "bg-neutral-900 border-neutral-700 text-neutral-100"
                      : "bg-white border-neutral-300"
                  }`}
                  title="1クリックあたりの角度変化(度)"
                />
                <div className="flex gap-1">
                  {[1, 5, 15].map((v) => (
                    <button
                      key={v}
                      onClick={() => setIntersectionAngleStep(v)}
                      className={chip(dark)}
                    >
                      {v}°
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <button
                  onClick={() => changeIntersectionAngle(-1)}
                  className={btn(dark)}
                >
                  −
                </button>
                <div
                  className={`flex items-center justify-center ${subtleText} font-mono`}
                >
                  {intersectionAngleDeg.toFixed(2)}°
                </div>
                <button
                  onClick={() => changeIntersectionAngle(1)}
                  className={btn(dark)}
                >
                  ＋
                </button>
              </div>
            </div>
            <div className="border-t border-neutral-800/30 pt-2 mt-2">
              <div className="flex justify-between items-center mb-1">
                <div className={`text-xs ${subtleText}`}>精密回転 (度)</div>
                <button
                  onClick={resetOrientation}
                  className={chip(dark)}
                  title="初期化時の姿勢とカメラに戻す"
                >
                  位置リセット
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={stepDeg}
                  min={0.1}
                  step={0.1}
                  onChange={(e) =>
                    setStepDeg(Math.max(0.1, parseFloat(e.target.value) || 0.1))
                  }
                  className={`w-20 border rounded px-2 py-1 text-right ${
                    dark
                      ? "bg-neutral-900 border-neutral-700 text-neutral-100"
                      : "bg-white border-neutral-300"
                  }`}
                  title="1クリックあたりの回転角度(度)"
                />
                <div className="flex gap-1">
                  {[1, 5, 15].map((v) => (
                    <button
                      key={v}
                      onClick={() => setStepDeg(v)}
                      className={chip(dark)}
                    >
                      {v}°
                    </button>
                  ))}
                </div>
              </div>
              {/* XYZ order; left = minus, right = plus */}
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                {/* X */}
                <button onClick={() => rotateBy("x", -1)} className={btn(dark)}>
                  −
                </button>
                <div
                  className={`flex items-center justify-center ${subtleText}`}
                >
                  X 軸
                </div>
                <button onClick={() => rotateBy("x", 1)} className={btn(dark)}>
                  ＋
                </button>

                {/* Y */}
                <button onClick={() => rotateBy("y", -1)} className={btn(dark)}>
                  −
                </button>
                <div
                  className={`flex items-center justify-center ${subtleText}`}
                >
                  Y 軸
                </div>
                <button onClick={() => rotateBy("y", 1)} className={btn(dark)}>
                  ＋
                </button>

                {/* Z */}
                <button onClick={() => rotateBy("z", -1)} className={btn(dark)}>
                  −
                </button>
                <div
                  className={`flex items-center justify-center ${subtleText}`}
                >
                  Z 軸
                </div>
                <button onClick={() => rotateBy("z", 1)} className={btn(dark)}>
                  ＋
                </button>
              </div>
            </div>
            <div className="border-t border-neutral-800/30 pt-2 mt-2">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={randomFrontRotation}
                  className={`px-3 py-1.5 rounded-lg ${
                    dark
                      ? "bg-neutral-800 hover:bg-neutral-700 text-neutral-100"
                      : "bg-neutral-100 hover:bg-neutral-200 text-neutral-900"
                  }`}
                >
                  ランダム
                </button>
                <button
                  onClick={resetAll}
                  className={`px-3 py-1.5 rounded-lg ${
                    dark
                      ? "bg-neutral-800 hover:bg-neutral-700 text-neutral-100"
                      : "bg-neutral-100 hover:bg-neutral-200 text-neutral-900"
                  }`}
                  title="姿勢、垂線の長さ、紙の角度を初期値に戻す"
                >
                  全てリセット
                </button>
              </div>
            </div>
            <div className={`mt-1 text-xs ${subtleText}`}>
              <span
                className="inline-block w-3 h-3 align-middle mr-1 rounded-full"
                style={{ background: "#e5e5e5", border: "1px solid #d4d4d4" }}
              />{" "}
              球体（neutral）
              <br />
              <span
                className="inline-block w-3 h-3 align-middle mr-1"
                style={{ background: "#d11a2a" }}
              />{" "}
              赤道(実線固定・背面も表示) / X 軸(ギズモ)
              <br />
              <span
                className="inline-block w-3 h-3 align-middle mr-1"
                style={{ background: "#22c55e" }}
              />{" "}
              自転軸(外:破線 / 内:点線) / Y 軸(ギズモ)
              <br />
              <span
                className="inline-block w-3 h-3 align-middle mr-1"
                style={{ background: "#2563eb" }}
              />{" "}
              Z 軸(ギズモ)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
