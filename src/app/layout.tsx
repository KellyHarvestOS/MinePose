import type { Metadata } from "next";
import "@fontsource-variable/golos-text";
import "@fontsource/russo-one";
import "@fontsource/tiny5";
import "@fontsource-variable/pixelify-sans";
import "@fontsource/press-start-2p";
import "@fontsource-variable/tektur";
import "@fontsource/rubik-mono-one";
import "./heading-fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MinePose — твоя Minecraft-мастерская",
  description: "Личная пиксельная мастерская. Создавай 3D-позы, собирай миниатюры и сохраняй идеи прямо в браузере.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
