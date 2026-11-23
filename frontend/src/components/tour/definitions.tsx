import type { ComponentType, ReactNode } from 'react';
import type { TourStepProps } from 'antd';
import {
  Wrench,
  Boxes,
  ScrollText,
  GitCompare,
  FileBarChart,
  FileText,
  Compass,
  LayoutGrid,
  Play,
  MessageSquare,
  Network,
  Gavel,
  PauseCircle,
  Layers,
  Search,
  Share2,
  BookOpen,
  Gauge,
  ListChecks,
  FlaskConical,
  Clock,
} from 'lucide-react';
import { AttackIcon, GuardIcon } from '@/components/icons/SecurityIcons';
import type { TourId } from './tourStore';

type Tone = 'brand' | 'allow' | 'block' | 'observe' | 'info';
type TourIcon = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;

// 行内关键词 chip：取自语义色板，保证引导文案与双空间主题同色。
function K({ children, tone = 'brand' }: { children: ReactNode; tone?: Tone }) {
  const color = tone === 'brand' ? 'var(--bb-brand-primary)' : `var(--bb-${tone}-text)`;
  const bg = tone === 'brand' ? 'var(--bb-brand-light)' : `var(--bb-${tone}-bg)`;
  return (
    <span className="bb-tour-k" style={{ color, background: bg }}>
      {children}
    </span>
  );
}

function Title({ icon: Icon, children }: { icon: TourIcon; children: ReactNode }) {
  return (
    <span className="bb-tour-step-title">
      <Icon size={15} strokeWidth={1.5} />
      {children}
    </span>
  );
}

const anchor = (key: string) => () => document.querySelector<HTMLElement>(`[data-tour="${key}"]`) as HTMLElement;
const byClass = (cls: string) => () => document.querySelector<HTMLElement>(cls) as HTMLElement;

// 窄屏下整列/整面板目标旁放不下卡片：改用 bottom/top（rc-tour 会自动翻转+平移防溢出）。
// 注意 'center' 是相对目标居中且不做视口钳制，窄屏会裁切，不能用作回退。
const place = (wide: TourStepProps['placement'], max: number, fallback: TourStepProps['placement'] = 'bottom') =>
  window.innerWidth <= max ? fallback : wide;

export const TOURS: Record<TourId, { label: string; steps: TourStepProps[] }> = {
  workspace: {
    label: '实验室工作台',
    steps: [
      {
        title: <Title icon={FlaskConical}>欢迎来到越界之前</Title>,
        description: (
          <>
            这是一个「编排靶标 Agent → 发起攻击 → 旁路监护 → 取证报告」的一体化红队测评平台。所有工具调用都在
            <K tone="info">内存仿真沙盒</K>
            中执行（右上角 SIM 标识），不会触碰真实系统，可以放心大胆地尝试。
          </>
        ),
        placement: 'center',
      },
      {
        title: <Title icon={Compass}>左侧导航：三大工作区</Title>,
        description: (
          <>
            <K>编排中心</K>配置靶标 Agent 的身份与权限；<K>实例管理</K>运行、克隆并进入攻防会话；
            <K>测评报告</K>查看根因分析与加固建议。下方的「攻防实验舱」入口会带你进入深色实时控制台。
          </>
        ),
        target: byClass('.bb-sider-nav'),
        placement: place('right', 900, 'bottom'),
      },
      {
        title: <Title icon={Play}>最快的开始方式：一键演示</Title>,
        description: (
          <>
            点击<K tone="allow">一键演示</K>，平台会自动创建靶标实例、开启会话并载入一条攻击样本，约 2
            分钟走完「编排 → 攻击 → 监护 → 取证」全流程，适合第一次接触的你。
          </>
        ),
        target: anchor('demo-banner'),
        placement: 'bottom',
      },
      {
        title: <Title icon={LayoutGrid}>三个能力入口</Title>,
        description: (
          <>
            想动手时从这里出发：编排中心从零配置一个 Agent；实例管理对已有靶标发起会话；测评报告回顾历史结论。
          </>
        ),
        target: anchor('capabilities'),
        placement: 'bottom',
      },
      {
        title: <Title icon={GuardIcon}>预置靶标模板</Title>,
        description: (
          <>
            不想从零配置？每个模板都预设了工具与防护档位，点右侧<K>演示</K>
            即可直接开跑，也可以去编排中心载入模板后微调。
          </>
        ),
        target: anchor('templates'),
        placement: place('right', 900),
      },
      {
        title: <Title icon={Clock}>随时回到上次的工作</Title>,
        description: (
          <>
            最近的会话与报告会列在这里，点击即可继续未完成的攻防或查看历史结论。右下角的
            <K>引导按钮</K>可随时重播本页引导。
          </>
        ),
        target: anchor('recent'),
        placement: place('left', 900),
      },
    ],
  },

  orchestration: {
    label: '编排中心',
    steps: [
      {
        title: <Title icon={ListChecks}>四步编排一个靶标 Agent</Title>,
        description: (
          <>
            按顺序填写：<K>1 基础身份</K>名称与系统提示词 → <K>2 工具权限</K>启用哪些工具及其读写范围 →
            <K>3 调用约束</K>次数与超时上限 → <K>4 防护档位</K>宽松 / 标准 / 严格。左侧可随时跳步。
          </>
        ),
        target: byClass('.bb-orch-steps'),
        placement: place('right', 1000, 'bottom'),
      },
      {
        title: <Title icon={Wrench}>中央编辑区</Title>,
        description: (
          <>
            当前步骤的表单在这里。系统提示词决定了 Agent 的「人设」与授权边界，也是后续语义层判定越权的基线，建议写清楚允许与禁止的动作。
          </>
        ),
        target: anchor('orch-editor'),
        placement: place('right', 1000),
      },
      {
        title: <Title icon={FlaskConical}>模板载入与策略预览</Title>,
        description: (
          <>
            右上角可从<K>预置模板</K>一键填充配置；<K tone="info">策略预览</K>会展示这份配置将生成的
            L1 / L2 / L3 三级防护策略，创建前先看一眼更安心。
          </>
        ),
        target: anchor('orch-header-extra'),
        placement: 'bottom',
      },
      {
        title: <Title icon={FileText}>右侧实时摘要</Title>,
        description: (
          <>
            编排摘要随编辑实时更新：启用工具、调用上限、防护档位一目了然。点击「校验配置」后，错误与警告也会显示在这里。
          </>
        ),
        target: byClass('.bb-orch-aside'),
        placement: place('left', 1000),
      },
      {
        title: <Title icon={GuardIcon}>校验 → 保存 → 创建</Title>,
        description: (
          <>
            建议先<K tone="info">校验配置</K>排除错误，再<K>保存配置</K>留档，最后
            <K tone="allow">创建实例</K>。实例创建成功后即可在实例管理中进入攻防会话。
          </>
        ),
        target: anchor('orch-actions'),
        placement: 'top',
      },
    ],
  },

  instances: {
    label: '实例管理',
    steps: [
      {
        title: <Title icon={Boxes}>新建与视图切换</Title>,
        description: (
          <>
            <K tone="allow">新建实例</K>前往编排中心；右侧可在卡片视图与表格视图之间切换，表格适合批量浏览大量实例。
          </>
        ),
        target: anchor('instances-header'),
        placement: 'bottom',
      },
      {
        title: <Title icon={Gauge}>一眼掌握全局</Title>,
        description: <>存活实例、就绪数量、累计调用与已销毁数实时统计，帮你判断当前实验规模。</>,
        target: anchor('instances-stats'),
        placement: 'bottom',
      },
      {
        title: <Title icon={Search}>按状态筛选</Title>,
        description: (
          <>
            实例有<K tone="allow">就绪</K>、<K tone="info">冻结</K>、<K tone="block">已销毁</K>
            等状态，点击筛选快速定位；「刷新」可拉取最新状态。
          </>
        ),
        target: anchor('instances-filter'),
        placement: 'bottom',
      },
      {
        title: <Title icon={AttackIcon}>实例卡片：一切操作的起点</Title>,
        description: (
          <>
            每张卡片可<K tone="allow">进入会话</K>（开启攻防控制台）、<K>克隆</K>（复制一份做对照）、查看
            <K tone="info">策略</K>、续期与回收。销毁的实例不可再进入会话。
          </>
        ),
        target: anchor('instances-list'),
        placement: place('top', 900),
      },
    ],
  },

  policies: {
    label: '策略管理',
    steps: [
      {
        title: <Title icon={Layers}>三级防护管线</Title>,
        description: (
          <>
            每次工具调用依次经过<K tone="info">L1 硬规则</K>（工具存在性 / 参数格式，毫秒级）→
            <K tone="allow">L2 注入检测</K>（提示词注入特征）→<K tone="observe">L3 语义判定</K>
            （模型对照基线判断越权）。点击上方层级卡可筛选对应策略。
          </>
        ),
        target: anchor('policies-levels'),
        placement: 'bottom',
      },
      {
        title: <Title icon={ScrollText}>策略条目列表</Title>,
        description: (
          <>
            策略由编排配置自动生成，按层级分组。支持关键字搜索与<K>自动 / 人工</K>
            来源筛选；点击任一条目在右侧查看详情。
          </>
        ),
        target: byClass('.bb-policies-grid'),
        placement: place('top', 900),
      },
      {
        title: <Title icon={FileText}>详情、基线与人工覆盖</Title>,
        description: (
          <>
            右侧展示选中策略的完整规则与命中统计；未选中时显示靶标基线摘要。对自动策略可
            <K tone="observe">人工覆盖</K>调整动作，覆盖记录会保留溯源。
          </>
        ),
        target: byClass('.bb-policies-aside'),
        placement: place('left', 900),
      },
    ],
  },

  console: {
    label: '攻防控制台',
    steps: [
      {
        title: <Title icon={Gauge}>控制台顶栏：靶标状态一览</Title>,
        description: (
          <>
            左侧是靶标身份与会话 ID；中间<K tone="allow">监护开关</K>可实时启停旁路防护（用于对照演示）；右侧风险环、今日额度、
            <K tone="info">实时 / 回放</K>模式与 SIM 仿真标识随时可见。
          </>
        ),
        target: byClass('.bb-topbar'),
        placement: 'bottom',
      },
      {
        title: <Title icon={MessageSquare}>左栏：对话 / 样本库 / 红队</Title>,
        description: (
          <>
            三个页签：<K>对话</K>像聊天一样向靶标发送消息（可尝试诱导它越权）；
            <K tone="observe">样本库</K>一键载入预置攻击样本；<K tone="block">红队</K>启动自动化多步攻击。
          </>
        ),
        target: anchor('chat-panel'),
        placement: place('right', 1100),
      },
      {
        title: <Title icon={Network}>中栏：攻防拓扑与调用链</Title>,
        description: (
          <>
            上方拓扑图实时展示「红队 → 业务 Agent → 判定网关 → 沙盒」的调用流向，被阻断的调用会标红；下方调用链按时间列出每次工具调用及判定结果，点击可联动右侧取证。
          </>
        ),
        target: anchor('chain-panel'),
        placement: place('bottom', 1100),
      },
      {
        title: <Title icon={Gavel}>右栏：判定取证 / 告警 / 质询</Title>,
        description: (
          <>
            <K tone="info">判定取证</K>展示选中调用的 L1 / L2 / L3 分层证据与原始入参；
            <K tone="observe">告警</K>汇总风险事件并可标注误报 / 漏报；<K tone="observe">质询</K>
            需要你人工裁决拿不准的调用。
          </>
        ),
        target: anchor('judge-panel'),
        placement: place('left', 1100),
      },
      {
        title: <Title icon={GitCompare}>对照实验：证明防护的价值</Title>,
        description: (
          <>
            点击<K tone="observe">对照实验</K>，以当前会话为 A 组，自动创建防护开关相反的 B
            组并重放同一输入，逐步对比判定差异——一眼看出监护拦截了什么。
          </>
        ),
        target: anchor('compare-btn'),
        placement: 'bottom',
      },
      {
        title: <Title icon={PauseCircle}>底部控制条</Title>,
        description: (
          <>
            会话可<K>暂停 / 恢复</K>、<K>重置</K>（开启新会话）、<K tone="block">终止</K>
            （不可再发消息）；测评完成后点<K tone="allow">生成报告</K>产出六部分取证报告。
          </>
        ),
        target: byClass('.bb-lab-controlbar'),
        placement: 'top',
      },
    ],
  },

  experiment: {
    label: '对照实验',
    steps: [
      {
        title: <Title icon={GitCompare}>实验概要</Title>,
        description: (
          <>
            这里说明对照维度（<K tone="observe">防护对照</K>或<K tone="info">实例对照</K>
            ）、对照输入与配置差异，右上角标签给出判定差异步数。
          </>
        ),
        target: anchor('exp-summary'),
        placement: 'bottom',
      },
      {
        title: <Title icon={Boxes}>A / B 两组概要</Title>,
        description: (
          <>
            <K tone="info">A 组</K>是起点会话，<K tone="observe">B 组</K>
            是对照会话。各自的风险环、拦截数与调用数并排呈现，点「控制台」可跳回对应会话继续操作。
          </>
        ),
        target: anchor('exp-runs'),
        placement: 'bottom',
      },
      {
        title: <Title icon={ListChecks}>逐步判定对比</Title>,
        description: (
          <>
            每一行是同一步调用在两组中的判定：<K tone="allow">放行</K> / <K tone="block">阻断</K> /
            <K tone="observe">质询</K> / 降级。判定不一致的步骤以琥珀色高亮——这些就是防护真正起作用的证据。
          </>
        ),
        target: anchor('exp-rows'),
        placement: place('top', 900),
      },
    ],
  },

  reports: {
    label: '测评报告',
    steps: [
      {
        title: <Title icon={FileBarChart}>报告从哪里来</Title>,
        description: (
          <>
            报告是会话的<K>只读快照</K>：在攻防控制台完成测评后点「生成报告」即可产出。这里汇总所有历史报告。
          </>
        ),
        target: anchor('reports-header'),
        placement: 'bottom',
      },
      {
        title: <Title icon={Gauge}>报告统计</Title>,
        description: <>报告总数、累计拦截与高危报告数，帮你快速定位最值得复盘的测评。</>,
        target: anchor('reports-stats'),
        placement: 'bottom',
      },
      {
        title: <Title icon={Search}>检索与筛选</Title>,
        description: (
          <>
            支持按靶标 / 结论 / 编号搜索，按<K tone="block">高危</K> / <K tone="observe">中危</K> /
            <K tone="allow">低危</K>筛选，卡片与表格两种视图。点击任一报告进入六章节详情。
          </>
        ),
        target: anchor('reports-list'),
        placement: place('top', 900),
      },
    ],
  },

  reportDetail: {
    label: '报告详情',
    steps: [
      {
        title: <Title icon={Share2}>分享与导出</Title>,
        description: (
          <>
            <K tone="info">分享</K>生成限时只读链接；<K tone="allow">导出 PDF</K>
            下载完整报告，适合归档与汇报。
          </>
        ),
        target: anchor('report-export'),
        placement: 'bottom',
      },
      {
        title: <Title icon={BookOpen}>六章节导航</Title>,
        description: (
          <>
            测评概要 → 靶标基线 → 攻击序列 → 风险分析 → 加固建议 → 局限性说明。点击章节快速定位，滚动时自动高亮当前章节。
          </>
        ),
        target: byClass('.bb-report-nav'),
        placement: place('right', 820, 'bottom'),
      },
      {
        title: <Title icon={FileText}>只读快照正文</Title>,
        description: (
          <>
            报告生成后不再随实例变化，根因归因与加固建议都基于生成时刻的证据链。重新生成会产生一份新报告，便于对比加固前后的效果。
          </>
        ),
        target: anchor('report-body'),
        placement: place('left', 820),
      },
    ],
  },
};

export interface TourMeta {
  id: TourId;
  label: string;
  desc: string;
  icon: TourIcon;
  entry: string;
  contextual?: boolean;
}

export const TOUR_META: TourMeta[] = [
  { id: 'workspace', label: '实验室工作台', desc: '平台总览与一键演示', icon: FlaskConical, entry: '/workspace' },
  { id: 'orchestration', label: '编排中心', desc: '四步配置靶标 Agent', icon: Wrench, entry: '/orchestration' },
  { id: 'instances', label: '实例管理', desc: '进入会话与克隆对照', icon: Boxes, entry: '/instances' },
  { id: 'policies', label: '策略管理', desc: '三级防护策略', icon: ScrollText, entry: '/instances', contextual: true },
  { id: 'console', label: '攻防控制台', desc: '实时攻击与监护', icon: AttackIcon, entry: '/instances', contextual: true },
  { id: 'experiment', label: '对照实验', desc: 'A/B 判定差异', icon: GitCompare, entry: '/instances', contextual: true },
  { id: 'reports', label: '测评报告', desc: '报告检索与筛选', icon: FileBarChart, entry: '/reports' },
  { id: 'reportDetail', label: '报告详情', desc: '六章节取证报告', icon: FileText, entry: '/reports', contextual: true },
];

export function tourForPath(path: string): TourId | null {
  if (path === '/' || path === '/workspace') return 'workspace';
  if (path === '/orchestration') return 'orchestration';
  if (path === '/instances') return 'instances';
  if (/^\/policies\//.test(path)) return 'policies';
  if (/^\/console\//.test(path)) return 'console';
  if (/^\/experiments\//.test(path)) return 'experiment';
  if (path === '/reports') return 'reports';
  if (/^\/reports\//.test(path)) return 'reportDetail';
  return null;
}