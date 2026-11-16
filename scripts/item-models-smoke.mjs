import http from "node:http";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import ts from "typescript";
import { chromium } from "@playwright/test";

const base = process.cwd();
const source = await readFile("src/lib/item-geometry.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('from "three"', 'from "/three.module.js"').replace('from "./items"', 'from "/catalog.js"');
const catalog = JSON.parse(await readFile("src/data/item-catalog.json", "utf8"));
const script = `
import * as THREE from '/three.module.js';
import { loadItemModel, disposeItemModel } from '/engine.js';
import { ITEM_CATALOG } from '/catalog.js';
window.errors = [];
window.result = null;
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setSize(256,256); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#221e2a');
scene.add(new THREE.HemisphereLight(0xf0e4ff,0x4c3d50,2.4));
const light = new THREE.DirectionalLight(0xfff5e8,3.4);light.position.set(-3,5,8);scene.add(light);
const rim = new THREE.DirectionalLight(0xb7a5ee,1.5);rim.position.set(4,3,-3);scene.add(rim);
const camera = new THREE.PerspectiveCamera(30,1,.01,100);
const picks = ['diamond_sword','diamond_pickaxe','grass_block','tnt','chest','ender_chest','shield','trident','enchanted_golden_apple','enchanted_book','potion','glass'];
const sheet = document.createElement('canvas');sheet.width = 256*4;sheet.height = 286*3;
const ctx=sheet.getContext('2d');ctx.fillStyle='#121017';ctx.fillRect(0,0,sheet.width,sheet.height);
document.body.appendChild(sheet);
const all = [];
for (const item of ITEM_CATALOG) {
  try {
    const model = await loadItemModel(item.id);
    scene.add(model);model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const extent = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
    let meshes=0,vertices=0,finite=true;
    model.traverse(node=>{if(node instanceof THREE.Mesh){meshes++;const p=node.geometry.getAttribute('position');vertices+=p.count;for(let i=0;i<p.count;i++) finite = finite && Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i));}});
    const distance = Math.max(extent.x,extent.y,extent.z)*2.7;
    camera.position.set(distance*.55,distance*.35,distance); camera.lookAt(centre);camera.updateProjectionMatrix();
    renderer.render(scene,camera);
    const pixels = new Uint8Array(256*256*4);renderer.getContext().readPixels(0,0,256,256,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels);
    let content=0;
    const background=pixels.slice(0,4);
    for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-background[0])+Math.abs(pixels[i+1]-background[1])+Math.abs(pixels[i+2]-background[2])>15)content++;
    const entry={id:item.id,kind:model.userData.kind,meshes,vertices,bounds:extent.toArray(),centre:centre.toArray(),finite,content};
    all.push(entry);
    const tile=picks.indexOf(item.id);
    if(tile>=0){const x=tile%4*256,y=Math.floor(tile/4)*286;ctx.drawImage(renderer.domElement,x,y);ctx.fillStyle='#e9dff4';ctx.font='13px Arial';ctx.textAlign='center';ctx.fillText(item.id,x+128,y+274);}
    scene.remove(model);disposeItemModel(model);
  } catch(error) {window.errors.push(item.id+': '+error.stack);}
}
renderer.dispose();
window.result={all,errors:window.errors,sheet:sheet.toDataURL('image/png')};
`;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1").pathname;
    if (url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    if (url === "/") { response.setHeader("content-type", "text/html"); response.end(`<style>body{margin:0;background:#121017}</style><script type="module">${script}</script>`); return; }
    if (url === "/engine.js") { response.setHeader("content-type", "text/javascript"); response.end(compiled); return; }
    if (url === "/catalog.js") { response.setHeader("content-type", "text/javascript"); response.end(`export const ITEM_CATALOG=${JSON.stringify(catalog)};export const getItemDefinition=id=>ITEM_CATALOG.find(item=>item.id===id);`); return; }
    let filename;
    if (["/three.module.js", "/three.core.js"].includes(url)) filename = path.join(base, "node_modules/three/build", url.slice(1));
    else if (url.startsWith("/minecraft/")) {
      filename = path.resolve(base, "public", "." + url);
      assert.ok(filename.startsWith(path.resolve(base, "public/minecraft") + path.sep));
    } else { response.writeHead(404); response.end(); return; }
    response.setHeader("content-type", filename.endsWith(".png") ? "image/png" : filename.endsWith(".json") ? "application/json" : "text/javascript");
    response.end(await readFile(filename));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const { port } = server.address();
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  const page=await browser.newPage({viewport:{width:1100,height:950}}),errors=[];
  page.on("pageerror",error=>errors.push(error.stack));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(()=>window.result!==null,{},{timeout:120000});
  const result=await page.evaluate(()=>window.result);
  await mkdir("artifacts/items",{recursive:true});
  await writeFile("artifacts/items/models-sheet.png",Buffer.from(result.sheet.split(",")[1],"base64"));
  delete result.sheet;
  result.browserErrors=errors;
  await writeFile("artifacts/items/models-report.json",JSON.stringify(result,null,2));
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(errors,[]);
  assert.equal(result.all.length,catalog.length);
  for(const item of result.all){assert.ok(item.meshes>0&&item.vertices>=24,item.id+" real mesh");assert.ok(item.bounds.every(n=>n>0),item.id+" true volume");assert.ok(item.centre.every(n=>Math.abs(n)<1e-5),item.id+" centred");assert.equal(item.finite,true,item.id+" finite");assert.ok(item.content>100,item.id+" rendered visible");}
  console.log(`PASS all ${result.all.length} official models: geometry, nonzero 3D volume, finite vertices, centering, textures and WebGL rendering. Screenshot artifacts/items/models-sheet.png`);
} finally {await browser?.close();server.close();}
