import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  type Application,
  type Container,
  type Graphics,
  type Text,
  type Sprite,
  type Texture,
  type AnimatedSprite,
} from "pixi.js";
import { useI18n } from "../i18n";
import { useTheme, type ThemeMode } from "../ThemeContext";
import CliUsagePanel from "./office-view/CliUsagePanel";
import VirtualPadOverlay from "./office-view/VirtualPadOverlay";
import {
  type OfficeViewProps,
  type Delivery,
  type RoomRect,
  type WallClockVisual,
  canScrollOnAxis,
  findScrollContainer,
  MIN_OFFICE_W,
  MOBILE_MOVE_CODES,
  type MobileMoveDirection,
  type SubCloneBurstParticle,
} from "./office-view/model";
import { type SupportedLocale } from "./office-view/themes-locale";
import { useCliUsage } from "./office-view/useCliUsage";
import {
  useMeetingPresenceSync,
  useCrossDeptDeliveryAnimations,
  useCeoOfficeCallAnimations,
} from "./office-view/useOfficeDeliveryEffects";
import { useOfficePixiRuntime } from "./office-view/useOfficePixiRuntime";
import { buildOfficeScene } from "./office-view/buildScene";

export default function OfficeView({
  departments,
  agents,
  tasks,
  subAgents,
  meetingPresence,
  activeMeetingTaskId,
  unreadAgentIds,
  crossDeptDeliveries,
  onCrossDeptDeliveryProcessed,
  ceoOfficeCalls,
  onCeoOfficeCallProcessed,
  onOpenActiveMeetingMinutes,
  customDeptThemes,
  themeHighlightTargetId,
  onOpenTaskQueue,
  onOpenSecretaryIntake,
  onSelectAgent,
  onSelectDepartment,
}: OfficeViewProps) {
  const { language, t } = useI18n();
  const { theme: currentTheme } = useTheme();
  const themeRef = useRef<ThemeMode>(currentTheme);
  themeRef.current = currentTheme;
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const texturesRef = useRef<Record<string, Texture>>({});
  const destroyedRef = useRef(false);
  const initIdRef = useRef(0);
  const initDoneRef = useRef(false);
  const [sceneRevision, setSceneRevision] = useState(0);

  // Animation state refs
  const tickRef = useRef(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const ceoPosRef = useRef({ x: 180, y: 60 });
  const ceoSpriteRef = useRef<Container | null>(null);
  const crownRef = useRef<Text | null>(null);
  const highlightRef = useRef<Graphics | null>(null);
  const animItemsRef = useRef<
    Array<{
      sprite: Container;
      status: string;
      baseX: number;
      baseY: number;
      particles: Container;
      agentId?: string;
      cliProvider?: string;
      deskG?: Graphics;
      bedG?: Graphics;
      blanketG?: Graphics;
    }>
  >([]);
  const roomRectsRef = useRef<RoomRect[]>([]);
  const deliveriesRef = useRef<Delivery[]>([]);
  const deliveryLayerRef = useRef<Container | null>(null);
  const prevAssignRef = useRef<Set<string>>(new Set());
  const agentPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const processedCrossDeptRef = useRef<Set<string>>(new Set());
  const processedCeoOfficeRef = useRef<Set<string>>(new Set());
  const spriteMapRef = useRef<Map<string, number>>(new Map());
  const ceoMeetingSeatsRef = useRef<Array<{ x: number; y: number }>>([]);
  const totalHRef = useRef(600);
  const officeWRef = useRef(MIN_OFFICE_W);
  const ceoOfficeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const breakRoomRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const breakAnimItemsRef = useRef<
    Array<{
      sprite: Container;
      baseX: number;
      baseY: number;
    }>
  >([]);
  const subCloneAnimItemsRef = useRef<
    Array<{
      container: Container;
      aura: Graphics;
      cloneVisual: Sprite;
      animated?: AnimatedSprite;
      frameCount: number;
      baseScale: number;
      baseX: number;
      baseY: number;
      phase: number;
      fireworkOffset: number;
    }>
  >([]);
  const subCloneBurstParticlesRef = useRef<SubCloneBurstParticle[]>([]);
  const subCloneSnapshotRef = useRef<Map<string, { parentAgentId: string; x: number; y: number }>>(new Map());
  const breakSteamParticlesRef = useRef<Container | null>(null);
  const breakBubblesRef = useRef<Container[]>([]);
  const wallClocksRef = useRef<WallClockVisual[]>([]);
  const wallClockSecondRef = useRef(-1);
  const localeRef = useRef<SupportedLocale>(language);
  localeRef.current = language;
  const themeHighlightTargetIdRef = useRef<string | null>(themeHighlightTargetId ?? null);
  themeHighlightTargetIdRef.current = themeHighlightTargetId ?? null;

  // Latest data via refs (avoids stale closures)
  const dataRef = useRef({ departments, agents, tasks, subAgents, unreadAgentIds, meetingPresence, customDeptThemes });
  dataRef.current = { departments, agents, tasks, subAgents, unreadAgentIds, meetingPresence, customDeptThemes };
  const cbRef = useRef({ onSelectAgent, onSelectDepartment });
  cbRef.current = { onSelectAgent, onSelectDepartment };
  const activeMeetingTaskIdRef = useRef<string | null>(activeMeetingTaskId ?? null);
  activeMeetingTaskIdRef.current = activeMeetingTaskId ?? null;
  const meetingMinutesOpenRef = useRef<typeof onOpenActiveMeetingMinutes>(onOpenActiveMeetingMinutes);
  meetingMinutesOpenRef.current = onOpenActiveMeetingMinutes;
  const [showVirtualPad, setShowVirtualPad] = useState(false);
  const showVirtualPadRef = useRef(showVirtualPad);
  showVirtualPadRef.current = showVirtualPad;
  const scrollHostXRef = useRef<HTMLElement | null>(null);
  const scrollHostYRef = useRef<HTMLElement | null>(null);

  const triggerDepartmentInteract = useCallback(() => {
    const cx = ceoPosRef.current.x;
    const cy = ceoPosRef.current.y;
    for (const r of roomRectsRef.current) {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y - 10 && cy <= r.y + r.h) {
        cbRef.current.onSelectDepartment(r.dept);
        break;
      }
    }
  }, []);

  const setMoveDirectionPressed = useCallback((direction: MobileMoveDirection, pressed: boolean) => {
    for (const code of MOBILE_MOVE_CODES[direction]) {
      keysRef.current[code] = pressed;
    }
  }, []);

  const clearVirtualMovement = useCallback(() => {
    (Object.keys(MOBILE_MOVE_CODES) as MobileMoveDirection[]).forEach((direction) => {
      setMoveDirectionPressed(direction, false);
    });
  }, [setMoveDirectionPressed]);

  const followCeoInView = useCallback(() => {
    if (!showVirtualPadRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const scaleX = officeWRef.current > 0 ? container.clientWidth / officeWRef.current : 1;
    const scaleY = totalHRef.current > 0 ? container.clientHeight / totalHRef.current : scaleX;

    let hostX = scrollHostXRef.current;
    if (!hostX || !canScrollOnAxis(hostX, "x")) {
      hostX = findScrollContainer(container, "x") ?? (document.scrollingElement as HTMLElement | null);
      scrollHostXRef.current = hostX;
    }

    let hostY = scrollHostYRef.current;
    if (!hostY || !canScrollOnAxis(hostY, "y")) {
      hostY = findScrollContainer(container, "y") ?? (document.scrollingElement as HTMLElement | null);
      scrollHostYRef.current = hostY;
    }

    let nextLeft: number | null = null;
    let movedX = false;
    if (hostX) {
      const hostRectX = hostX.getBoundingClientRect();
      const ceoInHostX = containerRect.left - hostRectX.left + ceoPosRef.current.x * scaleX;
      const ceoContentX = hostX.scrollLeft + ceoInHostX;
      const targetLeft = ceoContentX - hostX.clientWidth * 0.45;
      const maxLeft = Math.max(0, hostX.scrollWidth - hostX.clientWidth);
      nextLeft = Math.max(0, Math.min(maxLeft, targetLeft));
      movedX = Math.abs(hostX.scrollLeft - nextLeft) > 1;
    }

    let nextTop: number | null = null;
    let movedY = false;
    if (hostY) {
      const hostRectY = hostY.getBoundingClientRect();
      const ceoInHostY = containerRect.top - hostRectY.top + ceoPosRef.current.y * scaleY;
      const ceoContentY = hostY.scrollTop + ceoInHostY;
      const targetTop = ceoContentY - hostY.clientHeight * 0.45;
      const maxTop = Math.max(0, hostY.scrollHeight - hostY.clientHeight);
      nextTop = Math.max(0, Math.min(maxTop, targetTop));
      movedY = Math.abs(hostY.scrollTop - nextTop) > 1;
    }

    if (hostX && hostY && hostX === hostY) {
      if (movedX || movedY) {
        hostX.scrollTo({
          left: movedX && nextLeft !== null ? nextLeft : hostX.scrollLeft,
          top: movedY && nextTop !== null ? nextTop : hostX.scrollTop,
          behavior: "auto",
        });
      }
      return;
    }

    if (hostX && movedX && nextLeft !== null) {
      hostX.scrollTo({ left: nextLeft, top: hostX.scrollTop, behavior: "auto" });
    }
    if (hostY && movedY && nextTop !== null) {
      hostY.scrollTo({ left: hostY.scrollLeft, top: nextTop, behavior: "auto" });
    }
  }, []);

  useEffect(() => {
    const updateVirtualPadVisibility = () => {
      const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
      const isNarrowViewport = window.innerWidth <= 1024;
      setShowVirtualPad(isCoarsePointer || isNarrowViewport);
    };
    updateVirtualPadVisibility();
    window.addEventListener("resize", updateVirtualPadVisibility);
    return () => window.removeEventListener("resize", updateVirtualPadVisibility);
  }, []);

  useEffect(() => {
    if (!showVirtualPad) clearVirtualMovement();
  }, [showVirtualPad, clearVirtualMovement]);

  useEffect(
    () => () => {
      clearVirtualMovement();
    },
    [clearVirtualMovement],
  );

  /* ── BUILD SCENE (no app destroy, just stage clear + rebuild) ── */
  const buildScene = useCallback(() => {
    buildOfficeScene({
      appRef,
      texturesRef,
      dataRef,
      cbRef,
      activeMeetingTaskIdRef,
      meetingMinutesOpenRef,
      localeRef,
      themeRef,
      animItemsRef,
      roomRectsRef,
      deliveriesRef,
      deliveryLayerRef,
      prevAssignRef,
      agentPosRef,
      spriteMapRef,
      ceoMeetingSeatsRef,
      totalHRef,
      officeWRef,
      ceoPosRef,
      ceoSpriteRef,
      crownRef,
      highlightRef,
      ceoOfficeRectRef,
      breakRoomRectRef,
      breakAnimItemsRef,
      subCloneAnimItemsRef,
      subCloneBurstParticlesRef,
      subCloneSnapshotRef,
      breakSteamParticlesRef,
      breakBubblesRef,
      wallClocksRef,
      wallClockSecondRef,
      setSceneRevision,
    });
  }, []);

  const { cliStatus, cliUsage, cliUsageRef, refreshing, handleRefreshUsage } = useCliUsage(tasks);
  const secretaryStats = useMemo(() => {
    const waiting = tasks.filter((task) => task.status === "pending" || task.status === "planned").length;
    const active = tasks.filter((task) => task.status === "in_progress").length;
    const review = tasks.filter((task) => task.status === "review").length;
    const unassigned = tasks.filter((task) => !task.assigned_agent_id && task.status !== "done" && task.status !== "cancelled").length;
    return { waiting, active, review, unassigned };
  }, [tasks]);

  const tickerContext = useMemo(
    () => ({
      tickRef,
      keysRef,
      ceoPosRef,
      ceoSpriteRef,
      crownRef,
      highlightRef,
      animItemsRef,
      cliUsageRef,
      roomRectsRef,
      deliveriesRef,
      breakAnimItemsRef,
      subCloneAnimItemsRef,
      subCloneBurstParticlesRef,
      breakSteamParticlesRef,
      breakBubblesRef,
      wallClocksRef,
      wallClockSecondRef,
      themeHighlightTargetIdRef,
      ceoOfficeRectRef,
      breakRoomRectRef,
      officeWRef,
      totalHRef,
      dataRef,
      followCeoInView,
    }),
    [followCeoInView, cliUsageRef],
  );

  useOfficePixiRuntime({
    containerRef,
    appRef,
    texturesRef,
    destroyedRef,
    initIdRef,
    initDoneRef,
    officeWRef,
    scrollHostXRef,
    scrollHostYRef,
    deliveriesRef,
    dataRef,
    buildScene,
    followCeoInView,
    triggerDepartmentInteract,
    keysRef,
    tickerContext,
    departments,
    agents,
    tasks,
    subAgents,
    unreadAgentIds,
    language,
    activeMeetingTaskId,
    customDeptThemes,
    currentTheme,
  });

  useMeetingPresenceSync({
    meetingPresence,
    language,
    sceneRevision,
    deliveryLayerRef,
    texturesRef,
    ceoMeetingSeatsRef,
    deliveriesRef,
    spriteMapRef,
  });

  useCrossDeptDeliveryAnimations({
    crossDeptDeliveries,
    language,
    onCrossDeptDeliveryProcessed,
    deliveryLayerRef,
    texturesRef,
    agentPosRef,
    spriteMapRef,
    processedCrossDeptRef,
    deliveriesRef,
  });

  useCeoOfficeCallAnimations({
    ceoOfficeCalls,
    agents,
    language,
    onCeoOfficeCallProcessed,
    deliveryLayerRef,
    texturesRef,
    ceoMeetingSeatsRef,
    deliveriesRef,
    spriteMapRef,
    agentPosRef,
    processedCeoOfficeRef,
  });

  return (
    <div className="w-full overflow-auto" style={{ minHeight: "100%" }}>
      <div className="relative mx-auto w-full">
        <div className="absolute left-3 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] rounded-lg border border-white/70 bg-white/95 p-3 text-slate-950 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                {t({ ko: "비서실", en: "Secretary Office", ja: "秘書室", zh: "秘书办公室" })}
              </p>
              <h2 className="mt-0.5 text-sm font-bold">
                {t({
                  ko: "CEO 명령 접수",
                  en: "CEO command intake",
                  ja: "CEO指示受付",
                  zh: "CEO 指令接收",
                })}
              </h2>
            </div>
            <div className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
              {t({ ko: "QUEUE", en: "QUEUE", ja: "QUEUE", zh: "QUEUE" })}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              { label: t({ ko: "대기", en: "Waiting", ja: "待機", zh: "等待" }), value: secretaryStats.waiting },
              { label: t({ ko: "진행", en: "Active", ja: "進行", zh: "进行" }), value: secretaryStats.active },
              { label: t({ ko: "검토", en: "Review", ja: "確認", zh: "审查" }), value: secretaryStats.review },
              { label: t({ ko: "미배정", en: "Unassigned", ja: "未割当", zh: "未分配" }), value: secretaryStats.unassigned },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-center dark:border-slate-800 dark:bg-slate-900">
                <div className="text-base font-bold leading-none">{item.value}</div>
                <div className="mt-1 truncate text-[10px] font-medium text-slate-600 dark:text-slate-300">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenSecretaryIntake}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!onOpenSecretaryIntake}
            >
              {t({ ko: "명령 전달", en: "Send order", ja: "指示を送る", zh: "发送指令" })}
            </button>
            <button
              type="button"
              onClick={onOpenTaskQueue}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              disabled={!onOpenTaskQueue}
            >
              {t({ ko: "업무 큐 보기", en: "Open queue", ja: "キューを開く", zh: "打开队列" })}
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="mx-auto"
          style={{ maxWidth: "100%", lineHeight: 0, outline: "none" }}
          tabIndex={0}
        />

        <VirtualPadOverlay
          showVirtualPad={showVirtualPad}
          t={t}
          onInteract={triggerDepartmentInteract}
          onSetMoveDirectionPressed={setMoveDirectionPressed}
        />
      </div>

      <CliUsagePanel
        cliStatus={cliStatus}
        cliUsage={cliUsage}
        language={language}
        refreshing={refreshing}
        onRefreshUsage={handleRefreshUsage}
        t={t}
      />
    </div>
  );
}
