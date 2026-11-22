---
name: 越界之前 BeforeBound · Agent 安全实验室
description: 档案卷宗工作台——面向可编排 Agent 的自适应红队测评与动态旁路监护平台
colors:
  paper: "#f4f5f2"
  card: "#ffffff"
  index-tint: "#ecede8"
  hairline: "#d9dcd7"
  ink: "#1c1f24"
  ink-grey: "#5a6168"
  ink-faint: "#8a918b"
  brand-ink-green: "#1f6b5e"
  brand-teal: "#3e8f7e"
  brand-tint: "#e9f0ed"
  brand-deep: "#12382f"
  allow-ink: "#2e7d5b"
  observe-ink: "#8f6a14"
  block-ink: "#a33d3f"
  info-ink: "#3d6488"
  disabled-ink: "#97a1a8"
  ink-black: "#14171b"
  night-panel: "#191d22"
  night-card: "#1c2026"
  night-hairline: "#333941"
  bone: "#e8e6e0"
  night-muted: "#9aa1a8"
  night-accent: "#6bc7b3"
typography:
  display:
    fontFamily: "IBM Plex Sans, Inter, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.28
    letterSpacing: "0.3px"
  headline:
    fontFamily: "IBM Plex Sans, Inter, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.2px"
  body:
    fontFamily: "IBM Plex Sans, Inter, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.5px"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand-ink-green}"
    textColor: "{colors.card}"
    rounded: "{rounded.sm}"
    padding: "10px 22px"
  button-primary-hover:
    backgroundColor: "{colors.brand-deep}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.brand-ink-green}"
    rounded: "{rounded.sm}"
    padding: "8px 18px"
  stamp-block:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.block-ink}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  tag:
    backgroundColor: "{colors.brand-tint}"
    textColor: "{colors.brand-deep}"
    rounded: "{rounded.sm}"
    padding: "1px 7px"
---

# Design System: 越界之前 BeforeBound · Agent 安全实验室

## Overview

**Creative North Star: "档案卷宗工作台 (The Dossier Archive Workbench)"**

平台做成一套活的案卷系统。每一个业务对象——靶标实例、会话、告警、报告、样本、策略——都是一份带档号的卷宗；攻防控制台中的每一次判定以盖章留证的方式落印呈现；平台的工作流就是案卷的工作流：造靶（编排）→ 打靶（红队攻击）→ 判靶（旁路监护判定）→ 补靶（加固报告），全程编号、索引、留证、可追溯。

视觉世界取自档案馆与文书系统的工作纪律：编号即身份，发丝线即层级，留证即信任。日档是冷调纸面工作台（纸白底、墨字、发丝线），夜档是深墨阅档舱（深墨底、骨白字、发丝线，无霓虹无光晕）。两个空间共享同一套墨色状态语义与线形状态。

它明确拒绝：科技炫酷黑（纯黑+霓虹+发光数字）、默认英雄区、三等卡片行、紫蓝渐变、装饰代设计、满屏红色告警、为动画而动画。

**Key Characteristics:**
- 档号（FG-YYYY-NNNN）贯穿导航、状态带、卡片、报告——等宽字体，全局身份脊柱
- 判定章：双线方框、-12° 旋转、墨色语义，判定落印一次（350ms，墨晕扩散一次不循环）
- 线形状态：实线=运行、虚线=待定、半线=过期、划线=禁用——颜色之外的第二状态载体
- 双空间：日档纸白工作台 / 夜档深墨阅档舱，状态语义跨空间共享
- 克制：无装饰渐变、无光晕；深度靠 1px 发丝线

## Colors

纸墨与墨色的双空间体系：日档以冷调纸白承载信息，墨色承担全部文字与状态语义；夜档以深墨衬骨白，亮度校准但语义不变。

### Primary
- **墨绿 ink green** (#1f6b5e): 主操作（主按钮、选中态、链接、放行印章）、品牌强调。全站唯一的主强调色，占比约 10%。
- **深墨绿 brand deep** (#12382f): 主按钮悬浮、品牌深度色、页脚。
- **青瓷 teal** (#3e8f7e): 次级强调、连接线、图表系列。

### Neutral
- **纸白 paper** (#f4f5f2): 页面整体背景（冷调，避免纯白刺眼与暖奶油感）。
- **卡片白 card** (#ffffff): 卡片、面板、弹窗背景。
- **索引底 index tint** (#ecede8): 次级背景、代码块、时间线轨道、表格表头。
- **发丝线 hairline** (#d9dcd7): 分割线、卡片边框、输入框边框。深度主要来源。
- **墨 ink** (#1c1f24): 主文字、标题。
- **墨灰 ink grey** (#5a6168): 次要文字、说明。
- **淡墨 ink faint** (#8a918b): 占位符、禁用态、时间戳（不作正文）。

### Status (墨色语义，跨空间共享)
- **放行 allow ink** (#2e7d5b): 工具调用放行、链路正常、放行章。
- **观察 observe ink** (#8f6a14): 降级放行、质询、回放模式、质询章。
- **拦截 block ink** (#a33d3f): 拦截、高危告警、越权、拦截章。
- **信息 info ink** (#3d6488): 判定中、镜像监护中、提示。
- **未启用 disabled ink** (#97a1a8): 未启用、无数据、禁用。

### Night (夜档阅档舱)
- **深墨 ink black** (#14171b): 夜档主背景。
- **夜面板 night panel** (#191d22) / **夜卡 night card** (#1c2026): 面板与卡片背景。
- **夜发丝 night hairline** (#333941): 夜档分隔边框。
- **骨白 bone** (#e8e6e0): 夜档主文字。
- **夜尘 night muted** (#9aa1a8): 夜档次要文字。
- **夜绿 night accent** (#6bc7b3): 夜档活跃连接、高亮、品牌强调（亮度校准版）。

### Named Rules
**The Ink-Only Accent Rule.** 强调色只有墨绿一族；状态色只有墨色系。页面不出现高饱和荧光色，红色只出现在风险位置。

**The No-Neon Rule.** 夜档不发光：无霓虹边框、无光晕、无发光数字。深度来自墨色层次与发丝线。

## Typography

**Display Font:** IBM Plex Sans（自托管 woff2，回退 Inter / PingFang SC / Microsoft YaHei）
**Body Font:** IBM Plex Sans（同一字体栈，中文回退系统黑体）
**Label/Mono Font:** JetBrains Mono

**Character:** IBM Plex Sans 带来技术文档式的清晰与克制，与负责证据的 JetBrains Mono 同族不同工；中文标题走系统黑体，保证中文排版质量而不引入大字体包。

### Hierarchy
- **Display** (700, 34px/1.28, 0.3px tracking): 门户主标题、报告封面标题。
- **Headline** (700, 22px/1.4): 页面主标题（PageHeader）。
- **Title** (600, 15px): 卡片标题、面板标题。
- **Body** (400, 14px/22px): 正文、表单、表格；正文最大宽度 720px。
- **Label/Mono** (500, 11px, 0.5px tracking): 档号、工具参数、JSON、策略 ID、耗时——等宽只用于证据，不做装饰。

### Named Rules
**The Dossier Number Rule.** 每个业务对象携带档号 FG-YYYY-NNNN，以 JetBrains Mono 11–12px 呈现，是导航与跨引用的脊柱。

**The Evidence-Mono Rule.** 等宽字体只用于证据类内容（档号、权限参数、JSON、工具名、耗时），不用等宽做装饰。

## Layout

日档固定应用框架：左侧档号导航轨 224px（现实现 240px，含账户条）、顶部状态带 56px、内容区内边距 24px、卡片间距 16px、卡片内边距 16px（大面板 20px）。一级导航三个核心入口：编排中心、攻防控制台、测评报告；工作台首页为落地页。

夜档为独立全屏工作空间：进入 `/console/:sessionId` 或 `/experiments/:pairId` 隐藏日档导航，三栏布局（对话 30% / 拓扑 42% / 判定 28%，底部控制条 54px），状态带保留。

响应式：900px 以下侧栏转顶部横向导航；1100px 以下控制台三栏纵向堆叠；760px 以下顶栏换行；620px 以下控制条换行、图谱单列。

## Elevation & Depth

**平铺优先，发丝线分层。** 系统默认无阴影（`--fg-shadow-1: none`），卡片以 1px 发丝线与背景差分层；阴影只留给浮层（悬浮卡片 `0 2px 6px rgba(28,31,36,0.05)`、抽屉与模态 `0 8px 20px rgba(28,31,36,0.08)`）。夜档阴影为黑色半透明（`rgba(0,0,0,0.35)`）并配 1px 夜发丝描边。禁止零偏移色晕。

### Shadow Vocabulary
- **shadow-2** (`0 2px 6px rgba(28,31,36,0.05)`): 悬浮卡片、弹窗。
- **shadow-3** (`0 8px 20px rgba(28,31,36,0.08)`): 抽屉、模态、判定章浮层。

### Named Rules
**The Hairline-First Rule.** 层级先由发丝线解决；阴影是浮层的专利，不是卡片的默认装饰。

## Shapes

克制圆角，接近文书的直角气质：控件 6px、卡片 8px、容器与弹窗 10px、判定章 6px 双线方框（外框 2px + 偏移 2px 的 1px 描边）。骑缝条为纵向斜纹（115° 交替 6px 双色）装订条。无拟物材质、无玻璃拟态。

## Components

### Buttons
- **Shape:** 6px 圆角，无默认阴影。
- **Primary:** 墨绿实底（#1f6b5e），白字，10px 22px 内边距；悬浮为深墨绿（#12382f）。
- **Secondary / Ghost:** 白底墨绿边与字；链接式按钮走墨绿文字。
- 夜档主按钮使用夜绿强调色。

### Chips / Tags
- **Style:** 品牌浅底（#e9f0ed）配深墨绿文字，等宽字体；风险语义标签用对应状态墨色浅底。
- **State:** 印章式标签使用双线方框 + -12° 旋转（判定章）。

### Cards / Containers
- **Corner Style:** 8px 圆角（大面板 10px）。
- **Background:** 白卡 + 发丝线描边；次级底 #ecede8。
- **Shadow Strategy:** 平铺无阴影，见 Elevation。
- **Internal Padding:** 16px（大面板 20px）。

### Inputs / Fields
- **Style:** 白底、发丝线边框、6px 圆角。
- **Focus:** 墨绿边框，无发光光晕。
- **Error / Disabled:** 错误用墨红边框；禁用降透明度并保持可读。

### Navigation
- **Style:** 左侧档号导航轨，当前项白底+发丝线+阴影-2，挂工作区档号；顶部状态带显示当前靶标档号、防护档位、运行模式印章（LIVE 实章 / REPLAY 虚章）、SIM 仿真标识与配额细条。

### 判定章 (Judgement Stamp) — 签名组件
- **Shape:** 双线方框（2px 外框 + 2px 偏移 1px 内描边），6px 圆角，-12° 旋转。
- **Colors:** 放行章墨绿 / 拦截章墨红 / 质询章墨琥珀 / 降级章淡琥珀；REPLAY 章框虚线。
- **Behavior:** 判定完成时落入（scale 1.35→1、抗金刚回弹 settle，350ms）并伴随一次墨晕扩散（420ms，只一次不循环）。

### 骑缝条 (Dossier Spine)
- **Style:** 34px 宽纵向装订条，斜纹底 + 竖排档号（9.5px 等宽，`骑缝 FG-YYYY-NNNN`）。
- **Use:** 一键演示案卷、报告详情、对照实验双卷——表示"这是一卷完整的案卷"。

### 线形状态 (Status Line)
- **Style:** 3px 高状态条或同高线形：实线=运行/正常、虚线=待定/观察、半线=过期/停用、划线=禁用/已回收。
- **Use:** 实例表格行、策略层级、时间线轨道、状态带运行线。

## Do's and Don'ts

### Do:
- **Do** 让档号贯穿每个业务对象：导航、状态带、卡片角标、表格行、报告封面。
- **Do** 用四重传达状态：颜色 + 图标 + 文字 + 线形。
- **Do** 判定以判定章呈现，落印动效只发生一次。
- **Do** 用发丝线与背景差做层级，阴影只给浮层。
- **Do** 保持夜档无霓虹无光晕；深墨不是纯黑。

### Don't:
- **Don't** 使用科技炫酷黑、霓虹光效、发光数字。
- **Don't** 用三等卡片行（图标+标题+灰字）作页面结构；并列内容用索引条目或不对称权重。
- **Don't** 使用紫蓝渐变、装饰性光晕、噪点填充。
- **Don't** 让所有卡片 hover 统一上浮、所有区块统一淡入。
- **Don't** 用等宽字体做装饰，或满屏红色表达状态。
- **Don't** 用动画作为唯一信息源——静帧下状态必须完整可读，`prefers-reduced-motion` 关闭循环动画与落印动效。
