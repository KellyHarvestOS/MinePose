import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { chromium } from "@playwright/test";

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const main = compile(await readFile("src/lib/animation-export.ts", "utf8")).replaceAll('import("mediabunny")', 'import("/mediabunny.js")').replaceAll('../workers/animation-export-worker.ts', './worker.js');
const worker = compile(await readFile("src/workers/animation-export-worker.ts", "utf8")).replace('from "gifenc"', 'from "/gifenc.js"').replace('from "fflate"', 'from "/fflate.js"');
const assets = new Map([
  ["/export.js", main], ["/worker.js", worker],
  ["/mediabunny.js", await readFile("node_modules/mediabunny/dist/bundles/mediabunny.mjs", "utf8")],
  ["/gifenc.js", await readFile("node_modules/gifenc/dist/gifenc.esm.js", "utf8")],
  ["/fflate.js", await readFile("node_modules/fflate/esm/browser.js", "utf8")],
]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  if (pathname === "/") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>Animation export verification</title>"); return; }
  if (!assets.has(pathname)) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", "text/javascript"); response.end(assets.get(pathname));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const { exportAnimation, getAnimationExportCapabilities, getAnimationExportFrameTimes, renderAnimationAudio } = await import("/export.js");
    const { Input, ALL_FORMATS, BlobSource, EncodedPacketSink } = await import("/mediabunny.js");
    const checks = [], files = {}, metrics = {};
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const project = { schemaVersion: 1, kind: "animation", id: "test", name: "Export test", fps: 24, duration: 1, objects: [], tracks: [], layers: [], scene: { background: "#20152c" }, export: { format: "gif", width: 64, height: 64, fps: 24, start: .25, end: .75, transparent: true, quality: .8, loop: true, audio: false }, updatedAt: 0 };
    const calls = [], progress = [];
    const renderFrame = async (time, width, height, transparent) => {
      calls.push(time);
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!transparent) { context.fillStyle = "#20152c"; context.fillRect(0, 0, width, height); }
      context.fillStyle = "#e83291"; context.fillRect(Math.floor(time * 55), 10, 12, 26);
      context.fillStyle = "#32d5e8"; context.fillRect(Math.floor(time * 55) + 3, 14, 6, 6);
      return canvas;
    };
    async function save(name, blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer()); let data = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) data += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      files[name] = btoa(data);
    }
    const options = { project, renderFrame, signal: new AbortController().signal, onProgress: value => progress.push(value) };
    const times = getAnimationExportFrameTimes(project);
    assert(times.length === 12 && times[0] === .25 && Math.abs(times[11] - (.25 + 11 / 24)) < 1e-10, "exact fixed timestamps");
    const gif = await exportAnimation(options); await save("test.gif", gif.blob);
    assert(calls.every((time, index) => time === times[index]), "GIF requests fixed sample times");
    assert(progress[0] === 0 && progress.at(-1) === 1 && progress.every((value, index) => !index || value >= progress[index - 1]), "monotonic progress");
    const decoder = new ImageDecoder({ data: await gif.blob.arrayBuffer(), type: "image/gif" }); await decoder.tracks.ready;
    assert(decoder.tracks.selectedTrack.frameCount === 12, "GIF has all 12 encoded frames");
    const decoded = [];
    for (const index of [0, 11]) {
      const frame = await decoder.decode({ frameIndex: index }); const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d"); context.drawImage(frame.image, 0, 0); frame.image.close();
      const data = context.getImageData(0, 0, 64, 64).data;
      let left = 64; for (let pixel = 3; pixel < data.length; pixel += 4) if (data[pixel] > 200) left = Math.min(left, ((pixel - 3) / 4) % 64);
      assert(data[3] === 0, "GIF preserves transparent corner"); decoded.push(left);
    }
    decoder.close(); assert(decoded[1] > decoded[0] + 15, "GIF frames contain actual changing images");
    checks.push("GIF decodes to 12 changing transparent frames with fixed sample times and progress");
    project.export.format = "png-sequence"; calls.length = 0;
    const archive = await exportAnimation(options); await save("frames.zip", archive.blob);
    assert(calls.length === 12, "PNG sequence samples all frames"); checks.push("PNG sequence writes all 12 actual frame files and timing manifest");
    project.export.format = "png";
    const png = await exportAnimation(options); await save("frame.png", png.blob); checks.push("Single frame exports real PNG");
    project.export.format = "minepose";
    const editable = await exportAnimation(options); assert(JSON.stringify(JSON.parse(await editable.blob.text())) === JSON.stringify(project), "editable project round trip"); checks.push("Editable project retains the full versioned JSON");
    const capabilities = await getAnimationExportCapabilities(); metrics.capabilities = capabilities;
    for (const format of ["webm", "mp4"]) {
      if (!capabilities[format].supported) { assert(Boolean(capabilities[format].reason), "unsupported codec has clear reason"); continue; }
      project.export.format = format; project.export.transparent = false; calls.length = 0;
      const encoded = await exportAnimation(options); await save(`test.${format}`, encoded.blob);
      const input = new Input({ source: new BlobSource(encoded.blob), formats: ALL_FORMATS });
      const duration = await input.computeDuration(), track = await input.getPrimaryVideoTrack();
      assert(track !== null, `${format} video track`);
      const sink = new EncodedPacketSink(track); const packets = [];
      for await (const packet of sink.packets()) packets.push({ timestamp: packet.timestamp, duration: packet.duration });
      assert(packets.length === 12, `${format} all 12 fixed frames, received ${packets.length}`);
      assert(Math.abs(duration - .5) < .025, `${format} duration ${duration}`);
      assert(calls.length === 12 && calls.every((time, index) => time === times[index]), `${format} fixed source times`);
      metrics[format] = { duration, packets: packets.length, bytes: encoded.blob.size };
      input.dispose(); checks.push(`${format} is a real playable container with 12 timed encoded packets`);
    }
    const audioBytes = new ArrayBuffer(44 + 8000 * 2), wav = new DataView(audioBytes);
    function text(offset, value) { for (let index = 0; index < value.length; index++) wav.setUint8(offset + index, value.charCodeAt(index)); }
    text(0, "RIFF"); wav.setUint32(4, audioBytes.byteLength - 8, true); text(8, "WAVEfmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, 8000, true); wav.setUint32(28, 16000, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, "data"); wav.setUint32(40, 16000, true);
    for (let index = 0; index < 8000; index++) wav.setInt16(44 + index * 2, Math.sin(index / 8000 * Math.PI * 2 * 440) * 14000, true);
    let waveBase64 = ""; for (const byte of new Uint8Array(audioBytes)) waveBase64 += String.fromCharCode(byte);
    project.objects = [{ id: "audio", type: "audio", visible: true, opacity: 1, audio: { dataUrl: "data:audio/wav;base64," + btoa(waveBase64), duration: 1, offset: .1, trimStart: .2, trimEnd: .7, volume: .5, fadeIn: .05, fadeOut: .1, muted: false } }];
    const mixed = await renderAnimationAudio(project, .25, .75, new AbortController().signal);
    assert(mixed && mixed.length === 24000 && mixed.sampleRate === 48000, "audio has exact export range length");
    const channel = mixed.getChannelData(0), rms = (from, to) => Math.sqrt(channel.slice(from, to).reduce((sum, value) => sum + value * value, 0) / (to - from));
    assert(rms(1000, 8000) > .05 && rms(19000, 23000) < .0001, "offset, trim, fades and silent tail are applied");
    checks.push("Audio is decoded and mixed with trim, offset, gain, fades and exact range");
    if (capabilities.webm.supported) {
      project.export.format = "webm"; project.export.audio = true;
      const encoded = await exportAnimation(options); await save("audio.webm", encoded.blob);
      const input = new Input({ source: new BlobSource(encoded.blob), formats: ALL_FORMATS });
      assert(await input.getPrimaryAudioTrack(), "WebM contains the mixed audio track"); input.dispose();
      checks.push("WebM muxes the actual mixed Opus audio track");
    }
    project.export.audio = false; project.export.format = "gif"; project.export.width = project.export.height = 256; project.export.start = 0; project.export.end = 1;
    const controller = new AbortController(); let rendered = 0;
    const cancelling = exportAnimation({ ...options, signal: controller.signal, renderFrame: async (...args) => { rendered++; return renderFrame(...args); }, onProgress: value => { if (value > .12) controller.abort(); } });
    let cancelled = false; try { await cancelling; } catch (error) { cancelled = error.name === "AbortError"; }
    assert(cancelled && rendered < 24, "cancel stops GIF worker before remaining frames"); checks.push("Cancellation stops worker encoding and rejects with AbortError");
    project.export.format = "png"; project.export.width = 3840; project.export.height = 2160; project.export.transparent = true;
    let heartbeat = 0; const timer = setInterval(() => heartbeat++, 1);
    const large = await exportAnimation(options); clearInterval(timer); await save("frame-4k.png", large.blob);
    assert(heartbeat > 0, "4K PNG yields to the UI"); checks.push("4K PNG encodes asynchronously without freezing UI timers");
    return { passed: true, checks, metrics, files };
  });
  await mkdir("artifacts/animation-export", { recursive: true });
  for (const [name, bytes] of Object.entries(result.files)) await writeFile(`artifacts/animation-export/${name}`, Buffer.from(bytes, "base64"));
  const zip = unzipSync(Buffer.from(result.files["frames.zip"], "base64"));
  assert.equal(Object.keys(zip).filter(name => name.endsWith(".png")).length, 12);
  const manifest = JSON.parse(Buffer.from(zip["manifest.json"]).toString()); assert.equal(manifest.fps, 24); assert.equal(manifest.frames.length, 12);
  for (const [name, bytes] of Object.entries(zip)) if (name.endsWith(".png")) { const buffer = Buffer.from(bytes); assert.equal(buffer.readUInt32BE(16), 64); assert.equal(buffer.readUInt32BE(20), 64); }
  const fourK = Buffer.from(result.files["frame-4k.png"], "base64"); assert.equal(fourK.readUInt32BE(16), 3840); assert.equal(fourK.readUInt32BE(20), 2160);
  delete result.files; result.errors = errors; assert.deepEqual(errors, []);
  await writeFile("artifacts/animation-export/report.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); server.close(); }
