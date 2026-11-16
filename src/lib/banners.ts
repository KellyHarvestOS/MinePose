export type DyeId = "white" | "orange" | "magenta" | "light_blue" | "yellow" | "lime" | "pink" | "gray" | "light_gray" | "cyan" | "purple" | "blue" | "brown" | "green" | "red" | "black";
export type BannerLayer = { id: string; pattern: string; color: DyeId };
export type BannerDesign = { base: DyeId; layers: BannerLayer[] };
export type BannerPattern = { id: string; label: string; category: "stripes" | "shapes" | "icons"; texture: string };
export const DYES: { id: DyeId; label: string; hex: string }[] = [
  { id:"white",label:"Белый",hex:"#f9fffe" },{ id:"light_gray",label:"Светло-серый",hex:"#9d9d97" },
  { id:"gray",label:"Серый",hex:"#474f52" },{ id:"black",label:"Чёрный",hex:"#1d1d21" },
  { id:"brown",label:"Коричневый",hex:"#835432" },{ id:"red",label:"Красный",hex:"#b02e26" },
  { id:"orange",label:"Оранжевый",hex:"#f9801d" },{ id:"yellow",label:"Жёлтый",hex:"#fed83d" },
  { id:"lime",label:"Лаймовый",hex:"#80c71f" },{ id:"green",label:"Зелёный",hex:"#5e7c16" },
  { id:"cyan",label:"Бирюзовый",hex:"#169c9c" },{ id:"light_blue",label:"Голубой",hex:"#3ab3da" },
  { id:"blue",label:"Синий",hex:"#3c44aa" },{ id:"purple",label:"Фиолетовый",hex:"#8932b8" },
  { id:"magenta",label:"Пурпурный",hex:"#c74ebd" },{ id:"pink",label:"Розовый",hex:"#f38baa" }
];
export const MAX_BANNER_LAYERS = 6;
