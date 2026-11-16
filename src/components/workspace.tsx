"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ChevronRight, CircleHelp, Clapperboard, Clock3, Copy, Ellipsis, FolderClosed, FolderOpen, HardDrive, LayoutDashboard, LoaderCircle, Menu, Move3D, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { CharacterArt } from "./minecraft-scene";
import { makeProject, PRESETS, type Project } from "@/lib/types";
import { loadProjects, parseProject, storeProjects, STORAGE_KEY } from "@/lib/storage";
import { downloadDataUrl, downloadJson, validateSkin } from "@/lib/files";
import { TOOL_LINKS, type ToolId } from "@/lib/tools";
import { presetScene } from "@/lib/pose-presets";
import type { AnimationProject } from "@/lib/animation";
import { listAnimationProjects, saveAnimationProject } from "@/lib/animation-storage";
import { parseAnimationProject } from "@/lib/animation-validation";
import AnimationProjectList from "./animation-project-list";
import "./sidebar-collapse.css";

const PoseEditor = dynamic(() => import("./pose-editor"), { loading: () => <Loading /> });
const ToolsPanel = dynamic(() => import("./tools-panel"), { loading: () => <Loading /> });
const PoseLibrary = dynamic(() => import("./pose-library"), { loading: () => <Loading /> });
const HomeIntro = dynamic(() => import("./home-intro"), { loading: () => <Loading /> });
const AnimationStudio = dynamic(() => import("./animation-studio"), { loading: () => <Loading />, ssr: false });
type View = "home" | "poses" | "animations" | "tools" | "projects";
const NAV = [
  { id: "home" as const, label: "Главное", icon: LayoutDashboard },
  { id: "poses" as const, label: "Редактор поз", icon: Move3D },
  { id: "animations" as const, label: "Анимации", icon: Clapperboard },
  { id: "tools" as const, label: "Инструменты", icon: WandSparkles },
  { id: "projects" as const, label: "Мои проекты", icon: FolderClosed },
];
const PAGE_LABELS: Record<View, string> = { home: "Главное", poses: "Редактор поз", animations: "Animation Studio", tools: "Инструменты", projects: "Мои проекты" };
function Loading() { return <div className="loading-screen"><LoaderCircle className="animate-spin" size={24} /><span>Собираем блоки…</span></div>; }
function age(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч. назад`;
  return new Date(timestamp).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function Workspace() {
  const [view, setView] = useState<View>("home");
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [animationProjects, setAnimationProjects] = useState<AnimationProject[]>([]);
  const [initialPose, setInitialPose] = useState<Project | null>(null);
  const [initialAnimation, setInitialAnimation] = useState<AnimationProject | null>(null);
  const [animationHomeKey, setAnimationHomeKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [toast, setToast] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTop, setToolsTop] = useState(180);
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null);
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [skin, setSkin] = useState("");
  const [slim, setSlim] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [storageBytes, setStorageBytes] = useState(0);
  const [storageIssue, setStorageIssue] = useState(false);
  const projectsRef = useRef<Project[]>([]);
  const storageIssueRef = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const skinInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function notify(message: string) { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 4400); }
  useEffect(() => { try { setSidebarCollapsed(localStorage.getItem("minepose-sidebar-collapsed") === "true"); } catch {} }, []);
  useEffect(() => {
    if (!sidebarCollapsed || !toolsOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('#sidebar-tools, [aria-controls="sidebar-tools"]')) setToolsOpen(false); };
    const resize = () => setToolsOpen(false);
    window.addEventListener("pointerdown", outside); window.addEventListener("resize", resize);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resize); };
  }, [sidebarCollapsed, toolsOpen]);
  function toggleSidebar() {
    const next = !sidebarCollapsed; setSidebarCollapsed(next); setToolsOpen(false);
    try { localStorage.setItem("minepose-sidebar-collapsed", String(next)); } catch {}
  }
  useEffect(() => {
    try { const initial = loadProjects(); projectsRef.current = initial; setProjects(initial); setSkin(localStorage.getItem("minepose-skin") || ""); setSlim(localStorage.getItem("minepose-slim") === "true"); setReduced(localStorage.getItem("minepose-reduced") === "true"); setStorageBytes(new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size); }
    catch { storageIssueRef.current = true; setStorageIssue(true); notify("Не удалось прочитать данные браузера. Скачайте исходные данные в панели восстановления."); }
    setLoaded(true);
    const sync = (event: StorageEvent) => { if (event.key === STORAGE_KEY) try { const next = loadProjects(); projectsRef.current = next; setProjects(next); setStorageBytes(new Blob([JSON.stringify(next)]).size); } catch { /* keep last valid state */ } };
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("storage", sync); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => { document.documentElement.dataset.reduced = String(reduced); }, [reduced]);
  useEffect(() => {
    if (view !== "projects" && view !== "home") return;
    let current = true;
    void listAnimationProjects().then(value => { if (current) setAnimationProjects(value); }).catch(() => {});
    return () => { current = false; };
  }, [view]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { setDialog(null); setDeleteId(null); setMenuId(null); setSidebar(false); setToolsOpen(false); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    if (!dialog && !deleteId) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const candidates = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || []);
    candidates()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = candidates(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", trap);
    return () => { window.removeEventListener("keydown", trap); previous?.focus(); };
  }, [dialog, deleteId]);
  useEffect(() => {
    if (!menuId) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest(".project-menu-wrap")) setMenuId(null); };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [menuId]);

  function persist(next: Project[]) {
    if (storageIssueRef.current) { notify("Сначала скачайте исходные данные в панели восстановления."); return false; }
    try { storeProjects(next); projectsRef.current = next; setProjects(next); setStorageBytes(new Blob([JSON.stringify(next)]).size); return true; }
    catch { notify("Недостаточно места в браузере. Экспортируйте проекты в JSON и удалите ненужные."); return false; }
  }
  function save(project: Project) {
    const next = [project, ...projectsRef.current.filter(p => p.id !== project.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!persist(next)) throw new Error("Не удалось сохранить проект в браузере");
  }
  function recoverStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || "";
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      downloadDataUrl(url, "minepose-recovery-original.json");
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      localStorage.removeItem(STORAGE_KEY); projectsRef.current = []; setProjects([]);
      storageIssueRef.current = false; setStorageIssue(false); setStorageBytes(0);
      notify("Исходные данные скачаны. Создано чистое хранилище.");
    } catch { notify("Браузер запрещает локальное хранилище. Разрешите хранение данных для этого сайта."); }
  }
  function navigate(next: View) { setView(next); setActive(null); setQuery(""); setSidebar(false); setMenuId(null); if (next === "tools") { setSelectedTool(null); setToolsOpen(true); } else if (sidebarCollapsed) setToolsOpen(false); }
  function showAnimationsHome() { setInitialAnimation(null); setInitialPose(null); setAnimationHomeKey(value => value + 1); navigate("animations"); }
  function animatePose(project: Project) { setInitialPose(structuredClone(project)); setInitialAnimation(null); navigate("animations"); }
  function openAnimation(project: AnimationProject) { setInitialAnimation(project); setInitialPose(null); navigate("animations"); }
  function openTool(id: ToolId | null) { setSelectedTool(id); setToolsOpen(!sidebarCollapsed); setView("tools"); setActive(null); setQuery(""); setSidebar(false); setMenuId(null); }
  function rememberCharacter(nextSkin: string, nextSlim: boolean) {
    setSkin(nextSkin); setSlim(nextSlim);
    try { localStorage.setItem("minepose-skin", nextSkin); localStorage.setItem("minepose-slim", String(nextSlim)); }
    catch { notify("Персонаж изменён. Браузер не разрешил сохранить его для следующего посещения."); }
  }
  function create(presetId?: string) {
    const p = makeProject();
    p.scene.skin = skin; p.scene.slim = slim;
    const preset = PRESETS.find(value => value.id === presetId);
    if (preset) { p.name = preset.name; p.pose = structuredClone(preset.pose); p.scene = presetScene(preset, skin, slim); }
    setActive(p); setView("poses"); setSidebar(false);
  }
  function showPresets() {
    document.getElementById("ready-poses")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    document.getElementById("pl-library-title")?.focus({ preventScroll: true });
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Файл анимации должен быть меньше 100 МБ");
      const data = JSON.parse(await file.text());
      if (data?.kind === "animation") {
        const animation = { ...parseAnimationProject(data), id: crypto.randomUUID(), updatedAt: Date.now() };
        await saveAnimationProject(animation); openAnimation(animation); notify("Анимация импортирована"); return;
      }
      if (file.size > 8 * 1024 * 1024) throw new Error("Файл позы должен быть меньше 8 МБ");
      if (data && Array.isArray(data.projects)) {
        const imported = data.projects.map((value: unknown) => ({ ...parseProject(value), id: crypto.randomUUID(), updatedAt: Date.now() }));
        if (persist([...imported, ...projects])) { navigate("projects"); notify(`Восстановлено проектов: ${imported.length}`); }
        return;
      }
      const p = parseProject(data); p.id = crypto.randomUUID(); p.updatedAt = Date.now();
      if (p.kind !== "pose") throw new Error("Выберите JSON-файл позы. Создание миниатюр удалено.");
      if (persist([p, ...projects])) { setActive(p); setView("poses"); notify("Поза импортирована"); }
    } catch (e) { notify(e instanceof Error ? e.message : "Не удалось открыть проект"); }
  }
  async function importSkin(file?: File) {
    if (!file) return;
    try { const url = await validateSkin(file); localStorage.setItem("minepose-skin", url); setSkin(url); notify("Скин загружен. Он будет использоваться в новых проектах."); }
    catch (e) { notify(e instanceof Error ? e.message : "Не удалось загрузить скин"); }
  }
  function duplicate(project: Project) {
    const copy = { ...structuredClone(project), id: crypto.randomUUID(), name: `${project.name} — копия`, updatedAt: Date.now() };
    if (persist([copy, ...projects])) notify("Копия проекта создана"); setMenuId(null);
  }
  const poseProjects = projects.filter(project => project.kind === "pose");
  const visibleProjects = poseProjects.filter(project => project.name.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru") : b.updatedAt - a.updatedAt);
  const storageMB = (storageBytes / 1024 / 1024).toFixed(1);
  const pageLabel = view === "tools" && selectedTool ? TOOL_LINKS.find(tool => tool.id === selectedTool)?.label || PAGE_LABELS.tools : PAGE_LABELS[view];

  function projectCard(project: Project) {
    return <article className="project-card" key={project.id}>
      <button className="project-visual" onClick={() => { setActive(project); setView("poses"); }} aria-label={`Открыть ${project.name}`} style={{ background: project.scene.background }}>
        {project.preview ? <img src={project.preview} alt={project.name} /> : <CharacterArt variant={projects.indexOf(project) % 4} pose={project.pose} />}
        <span className="project-kind"><Move3D size={11} />3D-ПОЗА</span>
        <span className="open-project"><ArrowUpRight size={18} /></span>
      </button>
      <div className="project-details"><button className="project-title" onClick={() => { setActive(project); setView("poses"); }}>{project.name}</button><div className="project-meta"><span><Clock3 size={11} />{age(project.updatedAt)}</span><div className="project-menu-wrap"><button className="icon-btn tiny" aria-label={`Действия: ${project.name}`} onClick={() => setMenuId(menuId === project.id ? null : project.id)}><Ellipsis size={17} /></button>{menuId === project.id && <div className="project-menu"><button onClick={() => duplicate(project)}><Copy size={13} />Дублировать</button><button onClick={() => { downloadJson(project, `${project.name}.json`); setMenuId(null); }}><ArrowDownToLine size={13} />Экспорт JSON</button><button className="danger" onClick={() => { setDeleteId(project.id); setMenuId(null); }}><Trash2 size={13} />Удалить</button></div>}</div></div></div>
    </article>;
  }

  return <div className={`app-shell min-h-screen ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
    {sidebar && <button className="sidebar-backdrop" aria-label="Закрыть меню" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? "is-open" : ""}`}>
      <button className="sidebar-collapse-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"} title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"} aria-expanded={!sidebarCollapsed} aria-controls="main-sidebar-navigation">{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      <button className="brand" onClick={() => navigate("home")} aria-label="MinePose — главная" title="MinePose — главная"><span className="brand-compact-mark" aria-hidden="true"><Box size={24} strokeWidth={1.6} /></span><img src="/minepose-logo.png" alt="MinePose" /><span>ТВОЯ ЛИЧНАЯ МАСТЕРСКАЯ</span></button>
      <div className="sidebar-label">ПРОСТРАНСТВО ДЛЯ ИДЕЙ</div>
      <nav className="main-nav" id="main-sidebar-navigation" aria-label="Главное меню">
        {NAV.map(({ id, label, icon: Icon }) => (
          <Fragment key={id}>
            <button
              className={view === id ? "is-active" : ""}
              aria-label={label}
              title={label}
              onClick={event => { if (id === "tools") { setToolsTop(Math.max(12, Math.min(event.currentTarget.getBoundingClientRect().top, window.innerHeight - 190))); setToolsOpen(value => !value); } else if (id === "animations") showAnimationsHome(); else navigate(id); }}
              aria-expanded={id === "tools" ? toolsOpen : undefined}
              aria-controls={id === "tools" ? "sidebar-tools" : undefined}
              aria-current={view === id && id !== "tools" ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.6} /><span>{label}</span>
              {id === "projects" && <span className="nav-counter">{poseProjects.length + animationProjects.length}</span>}
              {id === "tools" ? <ChevronDown className={`nav-chevron nav-disclosure ${toolsOpen ? "is-open" : ""}`} size={14} /> : view === id && id !== "projects" && <ChevronRight className="nav-chevron" size={13} />}
            </button>
            {id === "tools" && (
              <div className="nav-tool-submenu" id="sidebar-tools" hidden={!toolsOpen} style={{ top: toolsTop }}>
                {TOOL_LINKS.map(tool => (
                  <button key={tool.id} className={view === "tools" && selectedTool === tool.id ? "is-active" : ""} aria-current={view === "tools" && selectedTool === tool.id ? "page" : undefined} onClick={() => openTool(tool.id)}>
                    <span className="nav-tool-dot" aria-hidden="true" /><span>{tool.label}</span>
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="sidebar-bottom"><div className="local-card"><div className="local-card-top"><span className="pixel-dot" /><span>ТВОЙ МИР — ТВОИ ПРАВИЛА</span></div><p>Только ты и твои идеи.<br />Всё сохраняется на устройстве.</p><div className="storage-line"><span>Локальное хранилище</span><span>{storageMB} МБ</span></div><div className="storage-track"><span style={{ width: `${Math.min(100, storageBytes / (5 * 1024 * 1024) * 100)}%` }} /></div><span className="storage-hint"><ShieldCheck size={11} /> Без регистрации и облака</span></div><button className="sidebar-secondary" aria-label="Настройки" title="Настройки" onClick={() => setDialog("settings")}><Settings2 size={17} /><span>Настройки</span><SlidersHorizontal size={12} /></button><button className="sidebar-secondary" aria-label="Как это работает" title="Как это работает" onClick={() => setDialog("help")}><CircleHelp size={17} /><span>Как это работает</span><ArrowUpRight size={12} /></button><div className="sidebar-footer"><span>MINEPOSE</span><span>v0.1 <span className="pixel-dot" /></span></div></div>
    </aside>
    <div className="main-shell min-w-0">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-btn" aria-label="Открыть меню" onClick={() => setSidebar(true)}><Menu size={20} /></button><Box size={16} /><span>Моё пространство</span><ChevronRight size={12} /><strong>{pageLabel}</strong></div><div className="topbar-right"><span className="local-status"><span className="pixel-dot" />Локальная студия</span><span className="topbar-divider" /><button className="topbar-help icon-btn" onClick={() => setDialog("help")} aria-label="Помощь"><CircleHelp size={18} /></button>{view !== "animations" && <button className="btn btn-muted btn-small" onClick={() => create()}><Plus size={15} />Новый проект</button>}</div></header>
      <main className={`main-content ${active || view === "animations" ? "editor-content" : ""} ${view === "animations" ? "animation-content" : ""}`}>
        {storageIssue && <div className="recovery-banner" role="alert"><span>Не удалось прочитать локальные проекты. Сначала сохрани исходные данные, затем начни с чистого хранилища.</span><button className="btn btn-muted btn-small" onClick={recoverStorage}>Скачать данные и восстановить</button></div>}
        {active ? <PoseEditor key={active.id} project={active} onSave={save} onAnimate={animatePose} onCharacterChange={rememberCharacter} onBack={() => { setActive(null); setView("poses"); }} onNotify={notify} /> : view === "animations" ? <AnimationStudio key={animationHomeKey} skin={skin} slim={slim} onNotify={notify} initialPose={initialPose} onInitialPoseConsumed={() => setInitialPose(null)} initialProject={initialAnimation} onInitialProjectConsumed={() => setInitialAnimation(null)} onOpenPose={project => { setActive(project); setView("poses"); }} /> : view === "tools" ? <ToolsPanel activeTool={selectedTool} onToolChange={openTool} onNotify={notify} onCreatePose={() => create()} /> : <>
          {view === "home" ? <HomeIntro skin={skin} slim={slim} reduced={reduced} onCreate={() => create()} onUploadSkin={() => skinInput.current?.click()} onShowPresets={showPresets} /> : <div className="page-intro collection-intro"><div><div className="eyebrow"><span className="pixel-dot" /> ТВОЁ ТВОРЧЕСКОЕ ПРОСТРАНСТВО</div><h1>{view === "poses" ? "Каждая поза — история" : "Твои идеи, по полочкам"}<span className="heading-square">.</span></h1><p>{view === "poses" ? "Настрой движения своего персонажа. Сохрани позу или экспортируй PNG." : "Личные позы хранятся в этом браузере. Продолжи с того места, где остановился."}</p></div></div>}

          <section className="projects-section"><div className="section-header"><div><FolderOpen size={18} /><h2>{view === "home" ? "Последние проекты" : view === "poses" ? "Мои позы" : "Все проекты"}</h2><span className="count-badge">{poseProjects.length}</span></div>{view === "home" ? <button className="text-link" onClick={() => navigate("projects")}>Все проекты<ArrowRight size={14} /></button> : <button className="text-link" onClick={() => importInput.current?.click()}><Upload size={14} />Импорт JSON</button>}</div>
            <div className="project-filters"><div className="filter-tabs"><button className="is-active">{view === "poses" ? "Мои позы" : "Все позы"}</button></div><div className="filter-controls"><label className="search-box"><Search size={14} /><input aria-label="Поиск проектов" placeholder="Найти проект…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={13} /></button>}</label><label className="sort-box"><SlidersHorizontal size={13} /><select aria-label="Сортировка проектов" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Сначала новые</option><option value="name">По названию</option></select><ChevronDown size={12} /></label></div></div>
            {!loaded ? <Loading /> : visibleProjects.length ? <div className="projects-grid">{(view === "home" ? visibleProjects.slice(0, 3) : visibleProjects).map(projectCard)}<button className="new-project-card" onClick={() => create()}><span className="new-project-plus"><Plus size={24} strokeWidth={1.4} /></span><strong>Новая история</strong><small>Здесь начинается что-то классное</small><span className="tiny-mono">НАЧАТЬ С ЧИСТОГО ХОЛСТА <ArrowUpRight size={11} /></span></button></div> : query ? <div className="search-empty"><Search size={26} /><h3>Пока ничего не нашлось</h3><p>Попробуй другое название позы.</p><button className="text-link" onClick={() => { setQuery(""); }}>Сбросить фильтры<ArrowRight size={13} /></button></div> : <div className="first-project"><div className="empty-world"><Box size={35} strokeWidth={1} /><span className="empty-pixel one" /><span className="empty-pixel two" /><span className="empty-pixel three" /></div><div><h3>Любой мир начинается с первого блока</h3><p>Создай свой первый проект — он появится здесь.<br />Или открой сохранённый файл и продолжи творить.</p></div><div className="empty-actions"><button className="btn btn-muted" onClick={() => create()}><Plus size={14} />Создать проект</button><button className="text-link subtle" onClick={() => importInput.current?.click()}><Upload size={12} />Открыть JSON-файл</button></div></div>}
          </section>

          {view === "projects" && <section className="projects-section animation-projects"><div className="section-header"><div><Clapperboard size={18} /><h2>Мои анимации</h2><span className="count-badge">{animationProjects.length}</span></div><button className="text-link" onClick={() => navigate("animations")}>Открыть студию<ArrowRight size={14} /></button></div>{animationProjects.filter(project => project.name.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))).length ? <AnimationProjectList projects={animationProjects.filter(project => project.name.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru") : b.updatedAt - a.updatedAt)} onOpen={openAnimation} onNotify={notify} onDeleted={ids => setAnimationProjects(previous => previous.filter(project => !ids.includes(project.id)))} /> : <div className="search-empty"><Clapperboard size={26} /><h3>{query ? "Анимации не найдены" : "Добавь движение в свою историю"}</h3><p>Ключевые кадры, персонажи и камера — в Animation Studio.</p><button className="text-link" onClick={() => navigate("animations")}>Создать анимацию<ArrowRight size={14} /></button></div>}</section>}

          {(view === "home" || view === "poses") && <div id="ready-poses" style={{ scrollMarginTop: 26 }}><PoseLibrary skin={skin} slim={slim} onOpen={create} onNotify={notify} onSlimChange={value => rememberCharacter(skin, value)} /></div>}
          {view === "home" && <section className="tool-callout"><div className="callout-symbol"><WandSparkles size={25} strokeWidth={1.4} /></div><div><h3>Маленькие инструменты. Большие возможности.</h3><p>Аватарки, пиксельные круги, баннеры и заголовки — всё под рукой.</p></div><button className="text-link" onClick={() => navigate("tools")}>Заглянуть в инструменты<ArrowRight size={15} /></button></section>}
          <footer className="page-footer"><span>СОЗДАНО ДЛЯ ТВОРЧЕСТВА<span className="footer-plus">+</span> ПОСТРОЕНО ИЗ БЛОКОВ</span><span>Неофициальный проект. Не связан с Mojang или Microsoft.</span></footer>
        </>}
      </main>
    </div>
    <input ref={importInput} type="file" accept=".json,.minepose,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
    <input ref={skinInput} type="file" accept="image/png" hidden onChange={e => { void importSkin(e.target.files?.[0]); e.target.value = ""; }} />
    {toast && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span><span>{toast}</span><button aria-label="Закрыть уведомление" onClick={() => setToast("")}><X size={14} /></button></div>}
    {(dialog || deleteId) && <div className="modal-backdrop" onClick={() => { setDialog(null); setDeleteId(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-btn" aria-label="Закрыть" onClick={() => { setDialog(null); setDeleteId(null); }}><X size={18} /></button>{deleteId ? <><span className="eyebrow">ЛОКАЛЬНОЕ ХРАНИЛИЩЕ</span><h2 id="modal-title">Удалить проект?</h2><p>«{projects.find(p => p.id === deleteId)?.name}» будет удалён из этого браузера. Экспортированный JSON-файл останется у тебя.</p><div className="modal-actions"><button className="btn btn-muted" onClick={() => setDeleteId(null)}>Оставить</button><button className="btn btn-danger" onClick={() => { if (persist(projects.filter(p => p.id !== deleteId))) { setDeleteId(null); notify("Проект удалён"); } }}><Trash2 size={14} />Удалить</button></div></> : dialog === "settings" ? <><span className="eyebrow">ПОДСТРОЙ ПОД СЕБЯ</span><h2 id="modal-title">Твоя мастерская</h2><div className="settings-row"><div><strong>Скин по умолчанию</strong><p>{skin ? "Твой скин используется в новых проектах" : "Сейчас используется скин путешественника"}</p></div><button className="btn btn-muted btn-small" onClick={() => skinInput.current?.click()}><Upload size={13} />Загрузить</button></div>{skin && <button className="text-link subtle" onClick={() => { localStorage.removeItem("minepose-skin"); setSkin(""); notify("Восстановлен стандартный скин"); }}>Вернуть стандартный скин</button>}<label className="settings-row"><div><strong>Спокойный режим</strong><p>Отключить вращение камеры на главной и переходы</p></div><input type="checkbox" checked={reduced} onChange={e => { setReduced(e.target.checked); try { localStorage.setItem("minepose-reduced", String(e.target.checked)); } catch { notify("Не удалось сохранить настройку браузера"); } }} /></label><div className="settings-row"><div><strong>Резервная копия</strong><p>{projects.length} проектов · {storageMB} МБ в этом браузере</p></div><button className="btn btn-muted btn-small" disabled={!projects.length} onClick={() => { downloadJson({ version: 1, projects }, "minepose-backup.json"); notify("Резервная копия скачана. Для импорта откройте её JSON-файл."); }}><ArrowDownToLine size={13} />Скачать</button></div><p className="modal-note"><HardDrive size={16} />Проекты хранятся в localStorage. Для переноса на другое устройство используй экспорт JSON. Очистка данных браузера удалит локальные проекты.</p></> : <><span className="eyebrow">НАЧНИ С ОДНОГО БЛОКА</span><h2 id="modal-title">Создавать — просто</h2><ol className="help-steps"><li><span>01</span><div><strong>Добавь своего персонажа</strong><p>Загрузи PNG-скин 64 × 64 или 64 × 32. Можно начать со стандартного.</p></div></li><li><span>02</span><div><strong>Найди свою позу</strong><p>Выбери часть тела и настрой повороты. Мышью вращай камеру, колёсиком меняй масштаб.</p></div></li><li><span>03</span><div><strong>Сохрани результат</strong><p>Сохрани проект в браузере, скачай PNG или экспортируй JSON для переноса.</p></div></li></ol><div className="help-shortcuts"><kbd>Ctrl</kbd> + <kbd>S</kbd><span>Сохранить в редакторе</span></div><button className="btn btn-primary" onClick={() => { setDialog(null); create(); }}><Plus size={14} />Создать первую позу</button></>}</section></div>}
  </div>;
}
