// Procedural planets for the pack covers: Earth (oceans, continents, ice caps, clouds, atmosphere),
// the Moon and Mars (the design's own Mars from RK). Pure shaders on spheres, no textures to download.

const NOISE = `
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return m289(((x*34.)+1.)*x);}
vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=m289(i);
  vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.,w=.5;for(int i=0;i<6;i++){a+=w*snoise(p);p*=2.02;w*=.5;}return a;}
`;

const EARTH = `
vec3 earthCol(vec3 p,out float rough,out float elev){
  vec3 q=p+vec3(fbm(p*1.3+11.),fbm(p*1.3+23.),fbm(p*1.3+37.))*.35;
  float n=fbm(q*1.45+3.1);
  float lat=abs(p.y);
  float coast=smoothstep(.0,.045,n);
  elev=coast*smoothstep(.04,.42,n);
  vec3 deep=vec3(.012,.05,.13),shelf=vec3(.03,.2,.33);
  vec3 sea=mix(deep,shelf,smoothstep(-.22,.02,n));
  float dry=smoothstep(.15,.55,fbm(p*3.1+5.)+.45-abs(lat-.32)*1.6);
  vec3 green=mix(vec3(.08,.2,.07),vec3(.2,.31,.12),smoothstep(.0,.3,fbm(p*6.+9.)));
  vec3 desert=vec3(.55,.43,.26);
  vec3 land=mix(green,desert,dry);
  land=mix(land,vec3(.32,.28,.24),smoothstep(.28,.5,n));
  vec3 c=mix(sea,land,coast);
  float ice=smoothstep(.76,.86,lat+fbm(p*4.)*.08);
  c=mix(c,vec3(.86,.9,.95),ice);
  rough=mix(.32,mix(.95,.6,ice),coast);
  return c;
}
`;

const MOON = `
vec3 moonCol(vec3 p,out float rough,out float elev){
  float m=fbm(p*1.6+7.);
  float mare=smoothstep(.05,.25,m);
  float cr=0.;
  for(int i=0;i<3;i++){vec3 s=p*(4.+float(i)*5.);vec3 c=fract(s)-.5;float d=length(c+vec3(snoise(floor(s))*.25));cr+=smoothstep(.32,.22,d)*smoothstep(.12,.2,d)*.35;}
  float g=.52+fbm(p*12.)*.12-mare*.2+cr*.25;
  rough=.95;elev=cr;
  return vec3(g*.95,g*.94,g*.92);
}
`;

function shaded(THREE: any, fn: 'earthCol' | 'moonCol', body: string) {
  const m = new THREE.MeshStandardMaterial({ roughness: .8, metalness: 0 });
  m.onBeforeCompile = (sh: any) => {
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj=normalize(position);');
    sh.fragmentShader = 'varying vec3 vObj;\n' + NOISE + body + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `float rr;float el;diffuseColor.rgb=${fn}(vObj,rr,el);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=rr;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{float h=el*.035;vec3 sp=-vViewPosition;vec3 sx=dFdx(sp),sy=dFdy(sp);vec3 qA=cross(sy,normal),qB=cross(normal,sx);float det=dot(sx,qA);vec2 dH=vec2(dFdx(h),dFdy(h));normal=normalize(abs(det)*normal-sign(det)*(dH.x*qA+dH.y*qB));}`);
  };
  return m;
}

function clouds(THREE: any) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh: any) => {
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj=normalize(position);');
    sh.fragmentShader = 'varying vec3 vObj;\n' + NOISE + '\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{vec3 p=vObj;vec3 q=p+vec3(fbm(p*2.+1.),fbm(p*2.+4.),0.)*.4;float c=fbm(q*3.2+vec3(0.,2.,0.));float band=1.-abs(p.y)*.35;diffuseColor.a*=smoothstep(.06,.42,c*band)*.85;}`);
  };
  return new THREE.Mesh(new THREE.SphereGeometry(1.018, 128, 96), m);
}

export type PlanetKind = 'earth' | 'mars' | 'moon';

/** A planet as a group of radius ~1 (plus atmosphere). */
export function planet(THREE: any, RK: any, kind: PlanetKind) {
  const g = new THREE.Group();
  if (kind === 'mars') {
    g.add(RK.mars());
    g.add(RK.atmosphere('#ff9a6a', 1.25));
    return g;
  }
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 144), kind === 'earth' ? shaded(THREE, 'earthCol', EARTH) : shaded(THREE, 'moonCol', MOON));
  g.add(body);
  if (kind === 'earth') {
    const c = clouds(THREE);
    c.onBeforeRender = () => { c.rotation.y = performance.now() * 0.000012; };
    g.add(c);
    g.add(RK.atmosphere('#6ab8ff', 1.9));
  }
  return g;
}

/** Light for planets: a white sun from the upper left and a faint blue fill. */
export function planetLight(THREE: any, scene: any) {
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.6); sun.position.set(-4, 2.2, 3.2); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6f8fbf, 0.18); fill.position.set(5, -1, 2); scene.add(fill);
  scene.add(new THREE.AmbientLight(0x1a2233, 0.22));
}
