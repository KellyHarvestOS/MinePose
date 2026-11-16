export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
}
export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  downloadDataUrl(url, filename); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("Не удалось прочитать файл")); r.readAsDataURL(file); });
}
export async function validateSkin(file: File): Promise<string> {
  if (file.type !== "image/png" || file.size > 2 * 1024 * 1024) throw new Error("Выберите PNG-скин размером до 2 МБ");
  const url = await readImage(file);
  const img = new Image(); img.src = url; await img.decode();
  if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) throw new Error("Размер скина должен быть 64 × 64 или 64 × 32 пикселя");
  return url;
}
