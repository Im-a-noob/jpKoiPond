// @ts-nocheck
import * as THREE from 'three';
import { P, WATER_Y, LAYER } from './params';

export { P, WATER_Y, LAYER };

export const STATE = { under: false, wasUnder: false, exitT: 99, depth: 0 };
export const RES = { scale: 1 };
export const perf = { ms: 16.7, fps: 60, slow: 0, acc: 0, frames: 0, sinceStart: 0 };
export const SHADOW = { frame: 0, dirty: true };

export const TEX: Record<string, any> = {};
export const RT: Record<string, any> = {};
export const SH: Record<string, any> = {};

export const shared: {
  canvas: HTMLCanvasElement | null;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  shadowCam: THREE.OrthographicCamera | null;
  reflCam: THREE.PerspectiveCamera | null;
  refrCam: THREE.PerspectiveCamera | null;
  clock: THREE.Clock | null;
  waterMat: any;
  skyUniforms: any;
  reflMatrix: THREE.Matrix4;
  options: any;
} = {
  canvas: null,
  renderer: null,
  scene: null,
  camera: null,
  shadowCam: null,
  reflCam: null,
  refrCam: null,
  clock: null,
  waterMat: null,
  skyUniforms: null,
  reflMatrix: new THREE.Matrix4(),
  options: {},
};

export const createDummyElement = (): any => {
  const dummy: any = {
    style: {},
    textContent: "",
    innerHTML: "",
    innerText: "",
    value: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    setAttribute() {},
    getAttribute() { return ""; },
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    remove() {},
    appendChild() {},
    removeChild() {},
    focus() {},
    blur() {},
    click() {},
    parentElement: null,
    parentNode: null,
    children: [],
    disabled: false,
  };
  return new Proxy(dummy, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
  });
};

export const $ = (id: string): any => {
  if (typeof document === 'undefined') return createDummyElement();
  const el = document.getElementById(id);
  if (el) return el;
  if (id === 'c') {
    const c = document.createElement('canvas');
    c.id = 'c';
    return c;
  }
  return createDummyElement();
};

export const nextTick = () => new Promise((r) => setTimeout(r, 0));

export async function progress(frac: number, msg: string) {
  try {
    const elBar = document.getElementById("loadbar");
    if (elBar) elBar.style.width = (frac * 100).toFixed(0) + "%";
    const elMsg = document.getElementById("loadmsg");
    if (elMsg) elMsg.textContent = msg;
  } catch (e) {}
  shared.options?.onProgress?.(frac, msg);
  await nextTick();
}

export function toast(msg: string) {
  try {
    const t = document.getElementById("toast");
    if (t) {
      t.textContent = msg;
      t.style.opacity = "1";
      clearTimeout((toast as any)._h);
      (toast as any)._h = setTimeout(() => { t.style.opacity = "0"; }, 2200);
    }
  } catch (e) {}
  shared.options?.onToast?.(msg);
}
