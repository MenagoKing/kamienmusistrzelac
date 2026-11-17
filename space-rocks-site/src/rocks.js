/* Space Rocks · procedural meteorites v2 for three.js r128. Shapes on the CPU, surfaces per pixel on the GPU. */
const RK = (() => {
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  function noise(seed) {
    const r = mulberry(seed), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const pm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { pm[i] = p[i & 255]; pm12[i] = pm[i] % 12; }
    const F3 = 1 / 3, G3 = 1 / 6;
    const c = (t, gi, x, y, z) => { if (t < 0) return 0; t *= t; const g = G[gi]; return t * t * (g[0] * x + g[1] * y + g[2] * z); };
    return (x, y, z) => {
      const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s), t = (i + j + k) * G3;
      const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
      else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3, x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3, x3 = x0 - 1 + .5, y3 = y0 - 1 + .5, z3 = z0 - 1 + .5;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      return 32 * (c(.6 - x0 * x0 - y0 * y0 - z0 * z0, pm12[ii + pm[jj + pm[kk]]], x0, y0, z0)
        + c(.6 - x1 * x1 - y1 * y1 - z1 * z1, pm12[ii + i1 + pm[jj + j1 + pm[kk + k1]]], x1, y1, z1)
        + c(.6 - x2 * x2 - y2 * y2 - z2 * z2, pm12[ii + i2 + pm[jj + j2 + pm[kk + k2]]], x2, y2, z2)
        + c(.6 - x3 * x3 - y3 * y3 - z3 * z3, pm12[ii + 1 + pm[jj + 1 + pm[kk + 1]]], x3, y3, z3));
    };
  }
  const fbm = (n, x, y, z, o) => { let a = 0, w = .5; for (let i = 0; i < o; i++) { a += w * n(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; w *= .5; } return a; };
  function worley(seed) {
    const h = (x, y, z, k) => { let v = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(seed + k, 2654435761); v = Math.imul(v ^ v >>> 15, 2246822507); v = Math.imul(v ^ v >>> 13, 3266489909); return ((v ^ v >>> 16) >>> 0) / 4294967296; };
    return (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); let d1 = 9, d2 = 9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cx = xi + a, cy = yi + b, cz = zi + c;
        const d = Math.hypot(cx + h(cx, cy, cz, 1) - x, cy + h(cx, cy, cz, 2) - y, cz + h(cx, cy, cz, 3) - z);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      return [d1, d2];
    };
  }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function icosphere(level) {
    const t = (1 + Math.sqrt(5)) / 2, nrm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
    const v = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(nrm);
    let f = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
    for (let l = 0; l < level; l++) {
      const cache = new Map(), nf = [];
      const mid = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; let m = cache.get(k); if (m === undefined) { v.push(nrm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); m = v.length - 1; cache.set(k, m); } return m; };
      for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      f = nf;
    }
    return { v, f };
  }
  const TYPES = { stone: 0, iron: 1, martian: 2, lunar: 3, pallasite: 4 };

  /* v2 surfaces: crust with fine orange-peel and flow lines, chipped areas that show the interior, a dark crust rim along the cut,
     polished interiors with real structure (chondrules, Widmanstätten, olivine, shock veins, breccia clasts). */
  const GLSL = `
varying vec3 vObjPos; varying float vChip; varying float vEdge;
uniform float uType; uniform vec3 uCutN; uniform float uCutD; uniform float uSeed; uniform float uBump;
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;} vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289(((x*34.)+1.)*x);} vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
i=m289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm3(vec3 p){float a=0.,w=.5;for(int i=0;i<4;i++){a+=w*snoise(p);p*=2.03;w*=.5;}return a;}
vec2 cell(vec3 p){vec3 i=floor(p),f=fract(p);float d1=8.,d2=8.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 g=vec3(float(x),float(y),float(z));
vec3 o=fract(sin(vec3(dot(i+g,vec3(127.1,311.7,74.7)),dot(i+g,vec3(269.5,183.3,246.1)),dot(i+g,vec3(113.5,271.9,124.6))))*43758.5453);
float d=length(g+o-f);if(d<d1){d2=d1;d1=d;}else if(d<d2){d2=d;}}return vec2(d1,d2);}
vec3 interior(vec3 p,out float r,out float m){vec3 c;
 if(uType<.5){vec2 a=cell(p*13.+uSeed),b=cell(p*7.+uSeed+3.);float g=fbm3(p*18.);c=mix(vec3(.15,.145,.135),vec3(.24,.23,.21),.5+.5*g);
  float ch=min(1.,smoothstep(.30,.24,a.x)+smoothstep(.27,.2,b.x)*.8);c=mix(c,mix(vec3(.30,.29,.27),vec3(.39,.37,.34),.5+.5*snoise(p*30.)),ch*.85);
  c=mix(c,vec3(.08,.075,.07),smoothstep(.33,.30,a.x)*(1.-ch)*.7);float fl=step(.78,snoise(p*55.+uSeed));c=mix(c,vec3(.72,.73,.75),fl);c=mix(c,vec3(.32,.17,.08),smoothstep(.5,.8,snoise(p*4.+uSeed))*.3);
  r=mix(.55,.28,fl);m=mix(.02,.85,fl);c*=.62;}
 else if(uType<1.5){vec3 q=p*7.;float a=abs(fract(dot(q,vec3(.82,.31,.48))+.13*snoise(q*.7))-.5);float b=abs(fract(dot(q,vec3(-.42,.85,.31))+.13*snoise(q*.7+4.))-.5);float d=abs(fract(dot(q,vec3(.21,-.38,.9))+.13*snoise(q*.7+9.))-.5);
  float mn=min(a,min(b,d));c=a<b&&a<d?vec3(.36,.37,.39):(b<d?vec3(.47,.48,.50):vec3(.41,.42,.44));c=mix(vec3(.62,.63,.65),c,smoothstep(.012,.03,mn));c=mix(vec3(.22,.23,.25),c,smoothstep(.0,.012,mn)+.2);r=.46;m=.55;}
 else if(uType<2.5){float g=fbm3(p*22.);c=mix(vec3(.035,.038,.032),vec3(.065,.07,.058),.5+.5*g);
  vec3 w=p+.06*vec3(snoise(p*7.),snoise(p*7.+3.),snoise(p*7.+7.));vec2 ol=cell(w*6.+uSeed);float olv=smoothstep(.27,.17,ol.x+.06*snoise(p*25.));
  c=mix(c,mix(vec3(.20,.20,.09),vec3(.30,.28,.12),.5+.5*snoise(p*30.)),olv*.95);
  vec2 la=cell(vec3(p.x*30.+p.y*11.,p.y*9.,p.z*30.-p.y*8.)+uSeed);c=mix(c,vec3(.34,.34,.32),smoothstep(.13,.06,la.x)*.75);
  float sp=step(.86,snoise(p*70.+uSeed));c=mix(c,vec3(.02,.02,.022),sp*.7);
  vec3 w2=p+.08*vec3(snoise(p*9.),snoise(p*9.+3.),snoise(p*9.+7.));float vein=(1.-smoothstep(.0,.012,abs(snoise(w2*3.4+uSeed))))*smoothstep(.1,.5,snoise(p*1.7+uSeed+2.));
  float pocket=smoothstep(.56,.8,snoise(w2*5.+uSeed+5.));c=mix(c,vec3(.008,.008,.01),max(vein*.95,pocket*.92));r=.42;m=.0;}
 else if(uType<3.5){vec2 a=cell(p*7.+uSeed),b=cell(p*15.+uSeed);c=mix(vec3(.18,.18,.175),vec3(.25,.25,.24),.5+.5*fbm3(p*9.));c=mix(c,vec3(.58,.58,.56),smoothstep(.32,.15,a.x)*.85);
  c=mix(c,vec3(.44,.44,.42),smoothstep(.22,.1,b.x)*.6);c=mix(c,vec3(.08,.08,.08),smoothstep(.55,.85,snoise(p*6.))*.7);r=.42;m=.02;c*=.6;}
 else{vec2 a=cell(p*5.5+uSeed);float o=smoothstep(.04,.13,a.y-a.x+.02*snoise(p*30.));vec3 ol=mix(vec3(.13,.10,.02),vec3(.33,.22,.03),.5+.5*snoise(p*11.));ol=mix(ol,vec3(.10,.09,.02),smoothstep(.2,.6,snoise(p*25.))*.5);ol+=vec3(.05,.04,.0)*smoothstep(.12,.0,a.x);
  c=mix(vec3(.52,.53,.55),ol,o);r=mix(.24,.3,o);m=mix(.95,.0,o);}
 return c;}
vec3 crust(vec3 p,out float r,out float m){float n=fbm3(p*3.+uSeed);float n2=snoise(p*16.+uSeed);vec3 c;
 if(uType<.5){c=mix(vec3(.045,.038,.033),vec3(.11,.085,.068),.5+.5*n);c=mix(c,vec3(.20,.11,.055),smoothstep(.4,.8,snoise(p*2.2+3.+uSeed))*.35);r=.78;m=.05;}
 else if(uType<1.5){c=mix(vec3(.085,.08,.075),vec3(.19,.16,.14),.5+.5*n);c=mix(c,vec3(.33,.15,.06),smoothstep(.2,.8,snoise(p*2.6+7.+uSeed))*.55);r=.46;m=.75;}
 else if(uType<2.5){c=mix(vec3(.014,.014,.016),vec3(.05,.046,.043),.5+.5*n);c=mix(c,vec3(.09,.055,.032),smoothstep(.45,.85,snoise(p*2.+uSeed))*.4);r=.36;m=.1;}
 else if(uType<3.5){vec2 cc=cell(p*6.+uSeed);c=mix(vec3(.15,.14,.13),vec3(.26,.25,.23),.5+.5*n);c=mix(c,vec3(.42,.41,.38),smoothstep(.14,.0,cc.x)*.5);c=mix(c,vec3(.10,.07,.045),smoothstep(.25,.65,snoise(p*1.8+uSeed))*.55);r=.78;m=.03;}
 else{c=mix(vec3(.09,.08,.07),vec3(.19,.15,.11),.5+.5*n);c=mix(c,vec3(.33,.15,.06),smoothstep(.2,.8,snoise(p*2.4+uSeed))*.5);r=.52;m=.6;}
 c*=.9+.12*n2;
 /* chipped crust shows rough, unpolished interior */
 float chip=smoothstep(.55,.95,vChip+.2*snoise(p*9.+uSeed));if(chip>0.){float r2,m2;vec3 ic=interior(p,r2,m2)*.5;c=mix(c,ic,chip);r=mix(r,.82,chip);m=mix(m,m2*.6,chip);}
 return c;}
`;
  const COLOR = `float fm=smoothstep(uCutD-.006,uCutD-.0012,dot(vObjPos,uCutN));float qR1,qM1,qR2,qM2;vec3 qC1=crust(vObjPos,qR1,qM1);vec3 qC2=interior(vObjPos,qR2,qM2);
qC2=mix(qC2,vec3(.012,.011,.01),smoothstep(.35,.9,vEdge)*.95);qR2=mix(qR2,.4,smoothstep(.55,1.,vEdge));
diffuseColor.rgb=mix(qC1,qC2,fm);float rR=mix(qR1,qR2,fm);float rM=mix(qM1,qM2,fm);`;
  /* orange-peel and flow lines on the crust; the polished cut stays almost flat */
  const BUMP = `{vec3 q=vObjPos;float flow=sin(dot(q,vec3(.3,9.,.2))*6.+snoise(q*3.)*3.)*.18;
float h=(1.-fm)*(snoise(q*12.+uSeed)*.55+snoise(q*30.)*.2+flow*.22*(1.-vChip))+fm*snoise(q*50.)*.01;h*=uBump;
vec3 sp=-vViewPosition;vec3 sx=dFdx(sp),sy=dFdy(sp);vec3 qA=cross(sy,normal),qB=cross(normal,sx);float det=dot(sx,qA);
vec2 dH=vec2(dFdx(h),dFdy(h));vec3 gr=sign(det)*(dH.x*qA+dH.y*qB);normal=normalize(abs(det)*normal-gr);}`;

  function material(type, cutN, cutD, seed, bump, phys) {
    const m = phys ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .8, metalness: .1, clearcoat: .0 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8, metalness: .1 });
    m.onBeforeCompile = sh => {
      sh.uniforms.uType = { value: TYPES[type] }; sh.uniforms.uCutN = { value: new THREE.Vector3(...(cutN || [0, 1, 0])) };
      sh.uniforms.uCutD = { value: cutN ? cutD : 99 }; sh.uniforms.uSeed = { value: seed % 97 }; sh.uniforms.uBump = { value: bump };
      sh.vertexShader = 'attribute float aChip;attribute float aEdge;varying vec3 vObjPos;varying float vChip;varying float vEdge;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos=position;vChip=aChip;vEdge=aEdge;');
      sh.fragmentShader = GLSL + sh.fragmentShader.replace('#include <color_fragment>', COLOR)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=rR;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=rM;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP);
    };
    return m;
  }

  /* o: {type, seed, level, stretch:[x,y,z], chips, dents, rough, cut:[nx,ny,nz], cutD, bump, smooth} */
  function rock(o) {
    const { v, f } = icosphere(o.level ?? 5), N = noise(o.seed), W = worley(o.seed + 7), R = mulberry(o.seed + 3);
    const st = o.stretch || [1, .8, .9], planes = [];
    for (let i = 0; i < (o.chips ?? 5); i++) { const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u); planes.push([[s * Math.cos(th), u, s * Math.sin(th)], .68 + R() * .2]); }
    const n = v.length, pos = new Float32Array(n * 3), chip = new Float32Array(n), edge = new Float32Array(n);
    const dents = o.dents ?? .05, rough = o.rough ?? .18, soft = .09;
    for (let i = 0; i < n; i++) {
      let [x, y, z] = v[i]; x *= st[0]; y *= st[1]; z *= st[2];
      const s = 1 + rough * fbm(N, x * 1.1, y * 1.1, z * 1.1, 3); x *= s; y *= s; z *= s;
      let ch = 0;
      for (const [nn, d] of planes) { const k = x * nn[0] + y * nn[1] + z * nn[2] - d; const ex = (k + Math.sqrt(k * k + soft * soft)) / 2 - soft / 2; if (ex > 0) { x -= nn[0] * ex * .92; y -= nn[1] * ex * .92; z -= nn[2] * ex * .92; ch = Math.max(ch, Math.min(1, ex * 9)); } }
      const L = Math.hypot(x, y, z), nx = x / L, ny = y / L, nz = z / L;
      const [a1, a2] = W(x * 2.3, y * 2.3, z * 2.3), [b1, b2] = W(x * 4.8 + 9, y * 4.8, z * 4.8);
      const dn = (-dents * sstep(0, .5, a2 - a1) - dents * .45 * sstep(0, .5, b2 - b1)) * (1 - ch * .85) + .008 * N(x * 7, y * 7, z * 7);
      x += nx * dn; y += ny * dn; z += nz * dn;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; chip[i] = ch;
    }
    // smooth the mesh a little so silhouettes read as stone, not noise (detail comes back per pixel)
    const nb = Array.from({ length: n }, () => []);
    for (const [a, b, c] of f) { nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
    for (let it = 0; it < (o.smooth ?? 2); it++) {
      const cp = pos.slice();
      for (let i = 0; i < n; i++) { const l = nb[i]; let sx = 0, sy = 0, sz = 0; for (const k of l) { sx += cp[k * 3]; sy += cp[k * 3 + 1]; sz += cp[k * 3 + 2]; }
        const m = l.length; pos[i * 3] = cp[i * 3] * .5 + sx / m * .5; pos[i * 3 + 1] = cp[i * 3 + 1] * .5 + sy / m * .5; pos[i * 3 + 2] = cp[i * 3 + 2] * .5 + sz / m * .5; }
    }
    let cn = null, cd = o.cutD ?? .5; if (o.cut) { const l = Math.hypot(...o.cut); cn = o.cut.map(a => a / l); }
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (cn) { const k = x * cn[0] + y * cn[1] + z * cn[2] - cd; if (k > 0) { x -= cn[0] * k; y -= cn[1] * k; z -= cn[2] * k; edge[i] = 1 - sstep(0, .11, k); } }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; maxR = Math.max(maxR, Math.hypot(x, y, z));
    }
    for (let i = 0; i < pos.length; i++) pos[i] /= maxR; cd /= maxR;
    const idx = new Uint32Array(f.length * 3); f.forEach((t, i) => { idx[i * 3] = t[0]; idx[i * 3 + 1] = t[1]; idx[i * 3 + 2] = t[2]; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aChip', new THREE.BufferAttribute(chip, 1)); g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    return new THREE.Mesh(g, material(o.type || 'stone', cn, cd, o.seed, o.bump ?? .012));
  }

  /* Mars: a lit globe whose albedo, polar caps and craters are computed per pixel */
  const MARS = `
vec3 marsCol(vec3 p,out float r){float n=fbm3(p*1.9+1.7);float n2=fbm3(p*5.5+3.);float n3=snoise(p*22.);vec3 base=mix(vec3(.30,.105,.045),vec3(.50,.215,.10),.5+.5*n2);
 vec3 c=mix(base,vec3(.11,.055,.035),smoothstep(-.02,.42,n)*.85);c=mix(c,vec3(.58,.32,.17),smoothstep(.35,.7,snoise(p*3.1+9.))*.35);c*=.94+.08*n3;vec2 cc=cell(p*6.5);float rim=smoothstep(.05,.0,abs(cc.x-.3));c*=.97+.05*rim-.05*smoothstep(.26,.0,cc.x);
 float cap=smoothstep(.87,.92,abs(p.y)+.05*snoise(p*8.));c=mix(c,vec3(.86,.83,.80),cap);r=.95;return c;}`;
  function mars() {
    const m = new THREE.MeshStandardMaterial({ roughness: .95, metalness: 0 });
    m.onBeforeCompile = sh => {
      sh.uniforms.uType = { value: 0 }; sh.uniforms.uCutN = { value: new THREE.Vector3(0, 1, 0) }; sh.uniforms.uCutD = { value: 99 }; sh.uniforms.uSeed = { value: 0 }; sh.uniforms.uBump = { value: .006 };
      sh.vertexShader = 'varying vec3 vObjPos;varying float vChip;varying float vEdge;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos=normalize(position);vChip=0.;vEdge=0.;');
      sh.fragmentShader = GLSL + MARS + '\n' + sh.fragmentShader.replace('#include <color_fragment>', 'float rR;diffuseColor.rgb=marsCol(vObjPos,rR);')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=rR;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{float h=(fbm3(vObjPos*9.)*.6+smoothstep(.07,.0,abs(cell(vObjPos*6.5).x-.3))*.25)*uBump;vec3 sp=-vViewPosition;vec3 sx=dFdx(sp),sy=dFdy(sp);vec3 qA=cross(sy,normal),qB=cross(normal,sx);float det=dot(sx,qA);vec2 dH=vec2(dFdx(h),dFdy(h));normal=normalize(abs(det)*normal-sign(det)*(dH.x*qA+dH.y*qB));}`);
    };
    return new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), m);
  }
  function atmosphere(color, k) {
    return new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 64), new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(color) }, k: { value: k } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vn;varying vec3 vv;void main(){vn=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vv=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'uniform vec3 c;uniform float k;varying vec3 vn;varying vec3 vv;void main(){float f=pow(1.-max(dot(vn,vv),0.),3.2);gl_FragColor=vec4(c*f*k,f);}'
    }));
  }
  /* image-based light as a small cube map computed from a sky gradient plus soft light panels (no render targets: works on every GPU) */
  function env(renderer, o) {
    const S = 64, hex = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }, top = hex(o.top), bot = hex(o.bottom);
    const lobes = o.panels.map(p => { const l = Math.hypot(...p.pos); return { d: p.pos.map(a => a / l), c: hex(p.c), i: p.i, w: p.w || .08 }; });
    const dirs = [(u, v) => [1, -v, -u], (u, v) => [-1, -v, u], (u, v) => [u, 1, v], (u, v) => [u, -1, -v], (u, v) => [u, -v, 1], (u, v) => [-u, -v, -1]];
    const faces = dirs.map(fd => {
      const cv = document.createElement('canvas'); cv.width = cv.height = S; const cx = cv.getContext('2d'), im = cx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let d = fd(2 * (x + .5) / S - 1, 2 * (y + .5) / S - 1); const l = Math.hypot(...d); d = d.map(a => a / l);
        const t = d[1] * .5 + .5; let r = bot[0] + (top[0] - bot[0]) * t, g = bot[1] + (top[1] - bot[1]) * t, b = bot[2] + (top[2] - bot[2]) * t;
        for (const L of lobes) { const k = L.i * Math.exp((d[0] * L.d[0] + d[1] * L.d[1] + d[2] * L.d[2] - 1) / L.w); r += L.c[0] * k; g += L.c[1] * k; b += L.c[2] * k; }
        const q = (y * S + x) * 4; im.data[q] = Math.min(255, Math.pow(r, 1 / 2.2) * 255); im.data[q + 1] = Math.min(255, Math.pow(g, 1 / 2.2) * 255); im.data[q + 2] = Math.min(255, Math.pow(b, 1 / 2.2) * 255); im.data[q + 3] = 255;
      }
      cx.putImageData(im, 0, 0); return cv;
    });
    const t = new THREE.CubeTexture(faces); t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; return t;
  }
  function stars(n, r0, r1, size, seed) {
    const R = mulberry(seed || 9), p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = R() * 2 - 1, th = R() * 6.2832, s = Math.sqrt(1 - u * u), r = r0 + R() * (r1 - r0); p[i * 3] = s * Math.cos(th) * r; p[i * 3 + 1] = u * r; p[i * 3 + 2] = s * Math.sin(th) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: true, color: 0xffffff, transparent: true, opacity: .85, depthWrite: false }));
  }
  function renderer(canvas, exposure) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = exposure || 1;
    return r;
  }
  /* size a renderer + camera to the canvas box, keep it sized, and only draw while on screen */
  function run(canvas, r, cam, draw) {
    let vis = true, w = 0, h = 0;
    const fit = () => { const b = canvas.getBoundingClientRect(); if (b.width && (b.width !== w || b.height !== h)) { w = b.width; h = b.height; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); } };
    new ResizeObserver(fit).observe(canvas); fit();
    new IntersectionObserver(e => { vis = e[0].isIntersecting; }).observe(canvas);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches; const t0 = performance.now();
    const shot = /still/.test(location.hash); let n = 0;   /* #still: draw a few frames at a fixed moment, then stop (for previews) */
    const loop = now => { if (shot && n > 2) return; requestAnimationFrame(loop); if (!vis && !shot) return; fit(); n++; draw(shot ? 2.4 : still ? 0 : (now - t0) / 1000); };
    requestAnimationFrame(loop);
    return { kick() { if (shot && n > 2) { n = 0; requestAnimationFrame(loop); } } };
  }
  return { rock, mars, atmosphere, env, stars, renderer, run, mulberry, noise };
})();
