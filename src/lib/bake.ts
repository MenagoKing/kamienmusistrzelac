// Baked rock surfaces. The design's rock material computes its surface per pixel every frame (dozens
// of noise and cell evaluations): beautiful, and far too heavy to turn smoothly on a phone. Here the
// very same shader code (taken from the material, not rewritten) is rendered once into two cube maps
// around the rock, looked up by the surface direction:
//   A (RGBA8):        sqrt(colour), roughness
//   B (half float):   metalness, bump height, cut mask
// The rock then draws with a plain PBR material reading those maps: same look, a fraction of the cost.
// Rocks are star-shaped from their centre, so one ray per direction hits the surface exactly once.

interface Parts { glsl: string; color: string; height: string }
let parts: Parts | null = null;

/** Pulls the GLSL out of the design's material with a stub compile (never edits the kit). */
function extract(material: any): Parts {
  if (parts) return parts;
  const sh: any = {
    uniforms: {}, vertexShader: '#include <begin_vertex>',
    fragmentShader: '#include <color_fragment>@@#include <roughnessmap_fragment>@@#include <metalnessmap_fragment>@@#include <normal_fragment_maps>',
  };
  material.onBeforeCompile(sh);
  const [colorPart, , , bumpPart] = sh.fragmentShader.split('@@');
  const at = colorPart.indexOf('float fm=');
  const bump = bumpPart.slice(bumpPart.indexOf('\n') + 1);
  parts = { glsl: colorPart.slice(0, at), color: colorPart.slice(at), height: bump.slice(1, bump.indexOf('vec3 sp=')) };
  return parts;
}

function uniformsOf(material: any) {
  const sh: any = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  material.onBeforeCompile(sh);
  return sh.uniforms as Record<string, { value: any }>;
}

interface Caps { half: boolean }
const caps = new WeakMap<any, Caps>();
function capsOf(renderer: any): Caps {
  let c = caps.get(renderer);
  if (!c) {
    const gl = renderer.getContext();
    const half = !!renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    c = { half };
    caps.set(renderer, c);
  }
  return c;
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

/**
 * Bakes a rock built by RK.rock / buildRock and swaps in the cheap material. Spreads the work over a
 * few frames (two cube faces per frame) so it never stalls the page. Resolves when the swap is done.
 */
export async function bakeRock(THREE: any, renderer: any, mesh: any, size: number): Promise<void> {
  if (mesh.userData.baked || mesh.userData.baking) return;
  mesh.userData.baking = true;
  const original = mesh.material;
  const p = extract(original);
  const u = uniformsOf(original);
  const { half } = capsOf(renderer);

  const bakeMat = new THREE.ShaderMaterial({
    uniforms: { uType: u.uType, uCutN: u.uCutN, uCutD: u.uCutD, uSeed: u.uSeed, uBump: u.uBump, uPass: { value: 0 } },
    vertexShader: 'attribute float aChip;attribute float aEdge;varying vec3 vObjPos;varying float vChip;varying float vEdge;\nvoid main(){vObjPos=position;vChip=aChip;vEdge=aEdge;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: p.glsl + '\nuniform float uPass;\nvoid main(){vec4 diffuseColor=vec4(1.);\n' + p.color +
      '\nif(uPass<.5){gl_FragColor=vec4(sqrt(max(diffuseColor.rgb,0.)),rR);}else{' + p.height +
      'gl_FragColor=vec4(rM,h/max(uBump,1e-5)*.5+.5,fm,1.);}}',
    side: THREE.DoubleSide,
  });
  const opt = (type: any) => ({ format: THREE.RGBAFormat, type, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const rtA = new THREE.WebGLCubeRenderTarget(size, opt(THREE.UnsignedByteType));
  const rtB = new THREE.WebGLCubeRenderTarget(size, opt(half ? THREE.HalfFloatType : THREE.UnsignedByteType));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(mesh.geometry, bakeMat));
  const cube = new THREE.CubeCamera(0.001, 10, rtA);
  cube.updateMatrixWorld(true); // the face cameras are children: their matrices need a manual update
  const cams = cube.children;

  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping, prevEnc = renderer.outputEncoding;
  const jobs: [any, number, number][] = [];
  for (let f = 0; f < 6; f++) { jobs.push([rtA, f, 0]); jobs.push([rtB, f, 1]); }
  try {
    for (let i = 0; i < jobs.length; i++) {
      if (i && i % 2 === 0) await nextFrame();
      const [rt, face, pass] = jobs[i];
      bakeMat.uniforms.uPass.value = pass;
      renderer.toneMapping = THREE.NoToneMapping; renderer.outputEncoding = THREE.LinearEncoding;
      renderer.setRenderTarget(rt, face);
      renderer.setClearColor(0, 0); renderer.clear();
      renderer.render(scene, cams[face]);
      renderer.setRenderTarget(prevTarget);
      renderer.toneMapping = prevTone; renderer.outputEncoding = prevEnc;
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone; renderer.outputEncoding = prevEnc;
    bakeMat.dispose();
  }

  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8, metalness: .1 });
  const bump = half ? u.uBump.value : 0;
  m.onBeforeCompile = (sh: any) => {
    sh.uniforms.tA = { value: rtA.texture }; sh.uniforms.tB = { value: rtB.texture }; sh.uniforms.uBumpB = { value: bump };
    sh.vertexShader = 'varying vec3 vObjPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos=position;');
    sh.fragmentShader = 'varying vec3 vObjPos;uniform samplerCube tA;uniform samplerCube tB;uniform float uBumpB;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', 'vec3 bDir=normalize(vObjPos);vec4 bA=textureCube(tA,bDir);vec4 bB=textureCube(tB,bDir);diffuseColor.rgb=bA.rgb*bA.rgb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=bA.a;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor=bB.r;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{float h=(bB.g*2.-1.)*uBumpB;vec3 sp=-vViewPosition;vec3 sx=dFdx(sp),sy=dFdy(sp);vec3 qA=cross(sy,normal),qB=cross(normal,sx);float det=dot(sx,qA);vec2 dH=vec2(dFdx(h),dFdy(h));vec3 gr=sign(det)*(dH.x*qA+dH.y*qB);normal=normalize(abs(det)*normal-gr);}');
  };
  m.customProgramCacheKey = () => 'sr-baked-rock';
  mesh.material = m;
  mesh.userData.baked = { rtA, rtB, original };
  mesh.userData.baking = false;
  original.dispose();
}

/** Frees a baked rock's maps and material (the geometry is shared and stays). */
export function disposeBaked(mesh: any) {
  const b = mesh.userData.baked;
  if (!b) return;
  b.rtA.dispose(); b.rtB.dispose(); mesh.material.dispose();
  mesh.userData.baked = null;
}

/** Renders a cube map of a material seen from the centre of a unit sphere (for planets). */
export async function renderCube(THREE: any, renderer: any, material: any, size: number, float: boolean) {
  const { half } = capsOf(renderer);
  const rt = new THREE.WebGLCubeRenderTarget(size, { format: THREE.RGBAFormat, type: float && half ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), material));
  const cube = new THREE.CubeCamera(0.01, 10, rt);
  cube.updateMatrixWorld(true);
  const prevTarget = renderer.getRenderTarget(), prevTone = renderer.toneMapping, prevEnc = renderer.outputEncoding;
  try {
    for (let f = 0; f < 6; f++) {
      if (f && f % 2 === 0) await nextFrame();
      renderer.toneMapping = THREE.NoToneMapping; renderer.outputEncoding = THREE.LinearEncoding;
      renderer.setRenderTarget(rt, f);
      renderer.setClearColor(0, 0); renderer.clear();
      renderer.render(scene, cube.children[f]);
    }
  } finally {
    renderer.setRenderTarget(prevTarget); renderer.toneMapping = prevTone; renderer.outputEncoding = prevEnc;
    scene.children[0].geometry.dispose();
  }
  return rt;
}
