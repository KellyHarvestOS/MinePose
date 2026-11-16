"use client";

import { ArrowDown, ArrowRight, ArrowUpRight, Check, ImageDown, LayoutGrid, Move3D, Upload, type LucideIcon } from "lucide-react";
import HeroVisual from "./hero-visual";
import { PRESETS } from "@/lib/pose-presets";
import { ITEM_CATALOG } from "@/lib/items";
import "./home-intro.css";

type Props = {
  skin: string;
  slim: boolean;
  reduced: boolean;
  onCreate: () => void;
  onUploadSkin: () => void;
  onShowPresets: () => void;
};

function CTAButtons({ skin, onCreate, onUploadSkin }: Pick<Props, "skin" | "onCreate" | "onUploadSkin">) {
  return <div className="hi-cta-group"><button className="hi-cta hi-cta-primary" onClick={onCreate}><Move3D size={17} />Создать первую позу<ArrowRight size={16} /></button><button className="hi-cta hi-cta-secondary" aria-label="Загрузить скин" onClick={onUploadSkin}><Upload size={16} />{skin ? "Заменить скин" : "Загрузить скин"}</button></div>;
}

function HeroContent({ skin, onCreate, onUploadSkin, onShowPresets }: Pick<Props, "skin" | "onCreate" | "onUploadSkin" | "onShowPresets">) {
  return <div className="hi-content"><span className="hi-eyebrow"><span aria-hidden="true"><i /><i /><i /></span>ТВОЯ MINECRAFT-МАСТЕРСКАЯ</span><h1 className="hi-title"><span>Твоя идея.</span><span>Твой скин.</span><span>Твоя сцена.</span></h1><p className="hi-description">Загрузи свой скин, выбери позу и добавь предметы. Всё для красивого кадра — в одном редакторе.</p><CTAButtons skin={skin} onCreate={onCreate} onUploadSkin={onUploadSkin} /><div className="hi-hero-footer"><button className="hi-template-link" onClick={onShowPresets}>Посмотреть готовые позы<ArrowDown size={13} /></button><span className="hi-ownership">Без ограничений. Всё твоё.</span></div></div>;
}

function HeroStats() {
  return <div className="hi-stats" aria-label="Возможности MinePose"><span><strong>{PRESETS.length}</strong>готовых поз</span><i aria-hidden="true" /><span><strong>{ITEM_CATALOG.length}</strong>предметов</span><i aria-hidden="true" /><span><ImageDown size={13} /><strong>PNG</strong>с прозрачным фоном</span></div>;
}

function ActionCard({ icon: Icon, title, description, onClick, loaded = false }: { icon: LucideIcon; title: string; description: string; onClick: () => void; loaded?: boolean }) {
  return <button className="hi-action-card" onClick={onClick} aria-label={title}><span className="hi-action-icon"><Icon size={21} strokeWidth={1.6} />{loaded && <span className="hi-skin-ready" title="Скин загружен"><Check size={8} strokeWidth={3} /></span>}</span><span className="hi-action-copy"><strong>{title}</strong><span>{description}</span></span><ArrowUpRight className="hi-action-arrow" size={16} /></button>;
}

function QuickActions({ skin, onCreate, onUploadSkin, onShowPresets }: Pick<Props, "skin" | "onCreate" | "onUploadSkin" | "onShowPresets">) {
  return <section className="hi-quick-actions" aria-label="Быстрые действия"><ActionCard icon={Move3D} title="Новая поза" description="Начни с чистого холста и найди свой ракурс." onClick={onCreate} /><ActionCard icon={LayoutGrid} title="Готовые позы" description={`Выбери одну из ${PRESETS.length} поз и настрой под себя.`} onClick={onShowPresets} /><ActionCard icon={Upload} title="Загрузить скин" description={skin ? "Твой персонаж уже здесь. Можно выбрать другой PNG." : "Добавь своего Minecraft-персонажа в мастерскую."} onClick={onUploadSkin} loaded={Boolean(skin)} /></section>;
}

export default function HomeIntro({ skin, slim, reduced, onCreate, onUploadSkin, onShowPresets }: Props) {
  return <div className="hi-home-intro"><section className="hi-hero" aria-label="Твоя Minecraft-мастерская"><HeroContent skin={skin} onCreate={onCreate} onUploadSkin={onUploadSkin} onShowPresets={onShowPresets} /><div className="hi-visual-shell"><HeroVisual skin={skin} slim={slim} reduced={reduced} /></div></section><div className="hi-actions-heading"><span>БЫСТРЫЙ СТАРТ</span><HeroStats /></div><QuickActions skin={skin} onCreate={onCreate} onUploadSkin={onUploadSkin} onShowPresets={onShowPresets} /></div>;
}
