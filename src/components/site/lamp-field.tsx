import { useEffect, useRef } from "react";

/**
 * The Lamplight backdrop: a fixed WebGL field of dots, one per 6px cell, sized by slowly drifting
 * 3D simplex noise, with a pool of light that follows the pointer (dots under it swell and turn
 * leaf-light; faster movement brightens it, then it settles). With no pointer for a few seconds the
 * light drifts on its own, so phones see it too. Two passes: noise at one texel per cell, then the
 * dots. Pauses while the tab is hidden; under prefers-reduced-motion the noise stops drifting.
 * Without WebGL it draws nothing and the page's own ground shows.
 */

type Rgb = [number, number, number];

const FIELD = {
  cellCss: 6,
  dot: [0.247, 0.604, 0.361] as Rgb, // small dots: leaf
  deep: [0.024, 0.071, 0.043] as Rgb, // large dots fade into the night ground
  hot: [0.714, 0.941, 0.765] as Rgb, // under the light
  volume: 0.9,
  sides: 0.26, // dim behind the centre column so the copy reads, full at the edges
  glow: 0.16,
  lampRadius: 320,
};

const NOISE = `precision highp float;uniform vec2 u_res;uniform float u_cell;uniform float u_time;uniform float u_scroll;
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}
void main(){vec2 cc=(floor(gl_FragCoord.xy)+0.5)*u_cell;vec2 uv=cc/u_res;uv=(uv-0.5)*vec2(u_res.x/u_res.y,1.0)+0.5;vec2 nuv=uv+vec2(0.0,u_scroll*0.5);
float hue=abs(snoise(vec3(nuv*0.3,u_time)));vec3 rb=hsv2rgb(vec3(hue,1.0,1.0));float gray=dot(rb,vec3(0.3,0.59,0.11));gray=pow(clamp(gray,0.0001,1.0),1.6842);
float g2=clamp(gray+0.5,0.0,1.0);float q=floor(g2*65535.0+0.5);gl_FragColor=vec4(floor(q/256.0)/255.0,mod(q,256.0)/255.0,0.0,1.0);}`;

const DOTS = `precision highp float;uniform sampler2D u_noise;uniform vec2 u_res;uniform vec2 u_cells;uniform float u_cell;
uniform vec2 u_mouse;uniform float u_R;uniform float u_k;uniform float u_vol;uniform float u_sides;uniform float u_glow;uniform vec3 u_c1;uniform vec3 u_c2;uniform vec3 u_hot;
void main(){vec2 pix=vec2(gl_FragCoord.x,u_res.y-gl_FragCoord.y);vec2 cell=floor(pix/u_cell);vec2 cc=(cell+0.5)*u_cell;vec2 suv=cc/u_res;
vec4 nz=texture2D(u_noise,(cell+0.5)/u_cells);float g2=(floor(nz.r*255.0+0.5)*256.0+floor(nz.g*255.0+0.5))/65535.0;
float d=length(cc-u_mouse)/u_R;float lamp=exp(-d*d*2.4)*u_k;float lc=clamp(lamp,0.0,1.0);
vec2 cuv=fract(pix/u_cell)-0.5;float dist=length(cuv);float aa=1.0/u_cell+1e-4;float rad=min(g2*0.5*(1.0+lc*0.55),0.5);
float mark=1.0-smoothstep(rad-aa,rad+aa,dist);vec3 col=mix(u_c1,u_c2,clamp(g2*2.0-1.0,0.0,1.0));col=mix(col,u_hot,lc*0.85);
float lateral=abs(suv.x-0.5)*2.0;float sides=mix(u_sides,1.0,smoothstep(0.5,0.96,lateral));sides=max(sides,lc);
float dotA=clamp(mark*u_vol*sides*(1.0+lc*0.5),0.0,1.0);float glowA=lc*u_glow;
gl_FragColor=vec4(u_hot*glowA*(1.0-dotA)+col*dotA,glowA*(1.0-dotA)+dotA);}`;

const VERT = "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}";

export function LampField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!gl) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const prog = (frag: string) => {
      const p = gl.createProgram()!;
      const v = gl.createShader(gl.VERTEX_SHADER)!;
      const f = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(v, VERT);
      gl.compileShader(v);
      gl.shaderSource(f, frag);
      gl.compileShader(f);
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, "a_pos");
      gl.linkProgram(p);
      return p;
    };
    const noiseP = prog(NOISE);
    const dotP = prog(DOTS);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
    const N = {
      res: u(noiseP, "u_res"),
      cell: u(noiseP, "u_cell"),
      time: u(noiseP, "u_time"),
      scroll: u(noiseP, "u_scroll"),
    };
    const D = {
      res: u(dotP, "u_res"),
      cells: u(dotP, "u_cells"),
      cell: u(dotP, "u_cell"),
      mouse: u(dotP, "u_mouse"),
      R: u(dotP, "u_R"),
      k: u(dotP, "u_k"),
      vol: u(dotP, "u_vol"),
      sides: u(dotP, "u_sides"),
      glow: u(dotP, "u_glow"),
      c1: u(dotP, "u_c1"),
      c2: u(dotP, "u_c2"),
      hot: u(dotP, "u_hot"),
    };
    gl.useProgram(dotP);
    gl.uniform1i(u(dotP, "u_noise"), 0);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();

    let W = 0,
      H = 0,
      cw = 0,
      ch = 0,
      dpr = 1,
      cell = FIELD.cellCss;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(window.innerWidth * dpr);
      const h = Math.round(window.innerHeight * dpr);
      if (w === W && h === H) return;
      W = w;
      H = h;
      cell = FIELD.cellCss * dpr;
      canvas.width = W;
      canvas.height = H;
      cw = Math.ceil(W / cell);
      ch = Math.ceil(H / cell);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    // pointer target, eased position, energy from speed; the light drifts on its own when idle
    let tx = window.innerWidth * 0.68,
      ty = window.innerHeight * 0.42,
      mx = tx,
      my = ty;
    let energy = 0,
      lastMove = -1e9,
      scrollNow = 0,
      scrollS = 0,
      pending = false,
      frameId = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      pending = false;
      if (document.hidden) return;
      size();
      const idle = now - lastMove > 4000;
      if (idle) {
        const a = now / 1000;
        tx = window.innerWidth * (0.62 + 0.2 * Math.sin(a * 0.31));
        ty = window.innerHeight * (0.42 + 0.16 * Math.sin(a * 0.47 + 1.2));
      }
      const ease = idle ? 0.03 : 0.14;
      mx += (tx - mx) * ease;
      my += (ty - my) * ease;
      energy *= 0.94;
      scrollS += (scrollNow - scrollS) * 0.12;
      const t = reduce ? 0 : ((now - t0) / 1000) * 0.06;

      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(noiseP);
      gl.uniform2f(N.res, cw * cell, ch * cell);
      gl.uniform1f(N.cell, cell);
      gl.uniform1f(N.time, t);
      gl.uniform1f(N.scroll, scrollS);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(dotP);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(D.res, W, H);
      gl.uniform2f(D.cells, cw, ch);
      gl.uniform1f(D.cell, cell);
      gl.uniform2f(D.mouse, mx * dpr, my * dpr);
      gl.uniform1f(D.R, FIELD.lampRadius * dpr);
      gl.uniform1f(D.k, 0.75 + energy);
      gl.uniform1f(D.vol, FIELD.volume);
      gl.uniform1f(D.sides, FIELD.sides);
      gl.uniform1f(D.glow, FIELD.glow);
      gl.uniform3fv(D.c1, FIELD.dot);
      gl.uniform3fv(D.c2, FIELD.deep);
      gl.uniform3fv(D.hot, FIELD.hot);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const settling =
        Math.abs(tx - mx) + Math.abs(ty - my) > 0.5 ||
        energy > 0.01 ||
        Math.abs(scrollNow - scrollS) > 0.001;
      if (!reduce || settling || idle) raf();
    };
    const raf = () => {
      if (!pending) {
        pending = true;
        frameId = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - tx,
        dy = e.clientY - ty;
      tx = e.clientX;
      ty = e.clientY;
      lastMove = performance.now();
      if (!reduce) energy = Math.min(energy + Math.hypot(dx, dy) * 0.0035, 0.9);
      raf();
    };
    const onScroll = () => {
      scrollNow = window.scrollY / (window.innerHeight || 1);
      raf();
    };
    const onResize = () => {
      onScroll();
      size();
    };
    const onVisible = () => {
      if (!document.hidden) raf();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    onScroll();
    scrollS = scrollNow;
    raf();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisible);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 block h-full w-full"
    />
  );
}
