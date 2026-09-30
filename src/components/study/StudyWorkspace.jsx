import React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// 可调学习工作台：左栏（视频 + 台词列表）↔ 右栏（台词精读）。
//
// Box 1 = 列间的竖向拖动手柄（PanelResizeHandle）。拖动它改变左栏宽度，
//   而视频以 16:9 等比渲染（VideoPlayer 内部 aspectRatio:16/9），宽度一变
//   高度自动随之变化——长宽同时改变，不会出现比例变形。台词列表与精读栏
//   的宽度也随之联动压缩/伸展。
// Box 2（台词列表高度调节）由父组件在台词区下方注入 SubListResizer，
//   不在此组件内部。
//
// 默认尺寸近似原有布局，autoSaveId 把用户拖拽后的比例持久化到本地。
export default function StudyWorkspace({
  videoSlot,
  subtitleSlot,
  analysisSlot,
  landscape = false,
  leftDefault = 70,
  rightDefault = 30,
}) {
  const hasAnalysis = !!analysisSlot;
  // 全屏且「台词列表」关闭时：视频上下居中（无论精读栏是否开启）；
  // 仅当台词列表打开时，视频才顶到顶部、与台词列表上下堆叠。
  const centered = landscape && !subtitleSlot;

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={landscape ? "study-ws-land" : "study-ws-desk"}
      className={`relative ${landscape ? "h-full w-full" : "w-full"}`}
    >
      <Panel order={1} defaultSize={hasAnalysis ? leftDefault : 100} minSize={38} className="min-w-0">
        {/* 固定包裹结构：无论是否居中，videoSlot 始终位于相同树位置，
            切换面板时 <video> 不会重新挂载，播放进度与流畅度不受影响。
            centered 时视频宽度占满面板并上下居中；否则顶对齐、台词列表紧贴其下。 */}
        <div className={centered ? "flex h-full w-full items-center justify-center" : ""}>
          <div className="w-full">{videoSlot}</div>
        </div>
        {!centered && subtitleSlot}
      </Panel>

      {/* 精读面板：analysisSlot 为 null 时不渲染，左栏自动扩展为 100% 宽度 */}
      {hasAnalysis && (
        <>
          {/* Box 1：视频宽度调节手柄（竖向），视频长宽等比联动 */}
          <PanelResizeHandle
            order={2}
            title="拖动以调整视频宽度（长宽等比缩放）"
            className="group relative z-20 w-2 shrink-0 cursor-col-resize"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/50 transition-colors group-hover:bg-mint/70" />
            <span className="absolute left-1/2 top-[42%] h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/70 transition-colors group-hover:bg-mint group-active:bg-mint" />
          </PanelResizeHandle>

          <Panel order={3} defaultSize={rightDefault} minSize={6} className="min-w-0">
            {analysisSlot}
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}