"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Clapperboard, Copy, LoaderCircle, Trash2, X } from "lucide-react";
import type { AnimationProject } from "@/lib/animation";
import { deleteAnimationProjects } from "@/lib/animation-storage";
import "./animation-project-list.css";

type Props = {
  projects: AnimationProject[];
  onOpen: (project: AnimationProject) => void;
  onDeleted: (ids: string[]) => void;
  onNotify: (message: string) => void;
  onDuplicate?: (project: AnimationProject) => void;
};

function age(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч. назад`;
  return new Date(timestamp).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function AnimationProjectList({ projects, onOpen, onDeleted, onNotify, onDuplicate }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectAll = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const titleId = useId();
  const visibleSelection = selected.filter(id => projects.some(project => project.id === id));
  const allSelected = projects.length > 0 && visibleSelection.length === projects.length;
  const pendingProjects = projects.filter(project => pendingIds.includes(project.id));
  const open = pendingIds.length > 0;

  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = visibleSelection.length > 0 && !allSelected; }, [visibleSelection.length, allSelected]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>(".apl-dialog-cancel")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) setPendingIds([]); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") || []), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keyboard, true); if (previous?.isConnected) previous.focus(); };
  }, [open]);

  function requestDelete(ids: string[]) { setError(""); setPendingIds(ids); }
  async function remove() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const ids = [...pendingIds]; await deleteAnimationProjects(ids);
      setPendingIds([]); setSelected(previous => previous.filter(id => !ids.includes(id))); onDeleted(ids);
      onNotify(ids.length === 1 ? "Анимация удалена" : `Удалено анимаций: ${ids.length}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось удалить анимации"); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <div className="apl-collection">
    <div className="apl-selection-bar">
      <label className="apl-select-all"><input ref={selectAll} type="checkbox" aria-label="Выбрать все анимации" checked={allSelected} disabled={!projects.length || busy} onChange={event => setSelected(event.target.checked ? projects.map(project => project.id) : [])} /><span>Выбрать все</span></label>
      <span className="apl-selection-count" aria-live="polite">{visibleSelection.length ? `Выбрано: ${visibleSelection.length}` : "Отметь анимации для удаления"}</span>
      {visibleSelection.length > 0 && <button className="apl-bulk-delete" aria-label="Удалить выбранные анимации" disabled={busy} onClick={() => requestDelete(visibleSelection)}><Trash2 size={14} /><span>Удалить выбранные</span><strong>{visibleSelection.length}</strong></button>}
    </div>
    <div className="apl-grid">{projects.map(project => <article className={`apl-card ${visibleSelection.includes(project.id) ? "is-selected" : ""}`} key={project.id}>
      <label className="apl-card-selection" title={`Выбрать: ${project.name}`}><input type="checkbox" aria-label={`Выбрать анимацию ${project.name}`} checked={visibleSelection.includes(project.id)} disabled={busy} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, project.id])] : previous.filter(id => id !== project.id))} /></label>
      <button className="apl-card-open" aria-label={`Открыть анимацию ${project.name}`} onClick={() => onOpen(project)}><span className="apl-card-symbol"><Clapperboard size={25} strokeWidth={1.3} /></span><span className="apl-card-copy"><strong>{project.name}</strong><small>{project.duration} с · {project.fps} FPS · {project.objects.filter(object => object.type === "character").length} перс.</small><small>{age(project.updatedAt)}</small></span><ArrowUpRight size={15} /></button>
      <div className="apl-card-actions">{onDuplicate && <button aria-label={`Дублировать анимацию: ${project.name}`} title="Дублировать" disabled={busy} onClick={() => onDuplicate(project)}><Copy size={13} /></button>}<button className="apl-card-delete" aria-label={`Удалить анимацию: ${project.name}`} title="Удалить анимацию" disabled={busy} onClick={() => requestDelete([project.id])}><Trash2 size={14} /></button></div>
    </article>)}</div>
    {open && createPortal(<div className="apl-dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) setPendingIds([]); }}><section ref={dialog} className="apl-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}><button className="apl-dialog-close" aria-label="Закрыть удаление анимаций" disabled={busy} onClick={() => setPendingIds([])}><X size={18} /></button><span className="apl-dialog-icon"><Trash2 size={23} /></span><h2 id={titleId}>{pendingIds.length === 1 ? "Удалить анимацию?" : `Удалить анимации (${pendingIds.length})?`}</h2><p>{pendingIds.length === 1 ? `«${pendingProjects[0]?.name || "Анимация"}» будет удалена из этого браузера.` : `Выбранные анимации будут удалены из этого браузера.`} Экспортированные файлы останутся у тебя.</p>{pendingIds.length > 1 && <ul>{pendingProjects.slice(0, 4).map(project => <li key={project.id}>{project.name}</li>)}{pendingIds.length > 4 && <li>И ещё {pendingIds.length - 4}</li>}</ul>}{error && <p className="apl-dialog-error" role="alert">{error}</p>}<div className="apl-dialog-actions"><button className="apl-dialog-cancel" disabled={busy} onClick={() => setPendingIds([])}>Отмена</button><button className="apl-confirm-delete" disabled={busy} onClick={() => void remove()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />}{pendingIds.length === 1 ? "Удалить" : `Удалить ${pendingIds.length}`}</button></div></section></div>, document.body)}
  </div>;
}
