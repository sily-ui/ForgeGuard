import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Collapse, Descriptions, Empty, Flex, Input, List, Modal, Progress, Space, Spin, Tag, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import {
  ArrowLeft,
  FileBarChart,
  Share2,
  Download,
  Copy,
  Check,
  ScrollText,
  Wrench,
  AlertTriangle,
  Info,
  Bot,
  User,
} from 'lucide-react';
import { AttackIcon } from '@/components/icons/SecurityIcons';
import { reportApi } from '@/services/api/resources';
import { exportReportPdf } from '@/services/report/exportPdf';
import { ApiClientError } from '@/services/api/client';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ModeBadge } from '@/components/common/ModeBadge';
import { SimBadge } from '@/components/common/SimBadge';
import { PresetTag } from '@/components/common/PresetTag';
import { DossierNo } from '@/components/common/DossierNo';
import { RISK_META, BOUNDARY_META, CATEGORY_NAMES, TOOL_META } from '@/utils/constants';
import { formatTime, formatDuration, truncate } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { HardeningSuggestion, Policy, ReportContent } from '@/types/api';

const SECTIONS = [
  { id: 'part1', label: '测评概要', icon: FileBarChart },
  { id: 'part2', label: '靶标基线快照', icon: ScrollText },
  { id: 'part3', label: '攻击序列', icon: AttackIcon },
  { id: 'part4', label: '风险分析', icon: AlertTriangle },
  { id: 'part5', label: '加固建议', icon: Wrench },
  { id: 'part6', label: '局限性说明', icon: Info },
];

const KIND_META: Record<string, { label: string; desc: string }> = {
  immediate: { label: '立即可改', desc: '配置项可直接修订' },
  tooling: { label: '工具改造', desc: '需修改工具入参校验' },
  tradeoff: { label: '业务取舍', desc: '需权衡代价' },
};

export default function ReportDetailPage() {
  const { reportId = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [active, setActive] = useState('part1');
  const [shareOpen, setShareOpen] = useState(false);

  const reportQuery = useQuery({ queryKey: ['report', reportId], queryFn: () => reportApi.get(reportId), enabled: !!reportId });
  const report = reportQuery.data;
  const content = report?.content;

  const shareMutation = useMutation({
    mutationFn: () => reportApi.shareLink(reportId, 72),
    onSuccess: () => setShareOpen(true),
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : '生成分享链接失败'),
  });

  const pdfMutation = useMutation({
    mutationFn: async () => {
      if (!report || !content) throw new Error('报告内容尚未就绪');
      return exportReportPdf({ ...report, content });
    },
    onSuccess: (filename) => message.success(`已开始下载 ${filename}`),
    onError: (err) => message.error(err instanceof ApiClientError ? err.message : (err as Error)?.message || 'PDF 导出失败'),
  });

  const scrollTo = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (reportQuery.isLoading) {
    return <div style={{ padding: 32, textAlign: 'center' }}><Spin size="large" /></div>;
  }
  if (!report || !content) {
    return (
      <div style={{ padding: 32 }}>
        <Empty description="报告不存在或已被清理">
          <Button type="primary" onClick={() => navigate('/reports')}>返回报告中心</Button>
        </Empty>
      </div>
    );
  }

  const ov = content.part1_overview;
  const dossierNo = dossierFromId(report.report_id);

  return (
    <div>
      <PageHeader
        icon={<FileBarChart size={20} strokeWidth={1.5} />}
        title={`测评报告 · ${ov.instance_name}`}
        subtitle={
          <Space size={8} wrap>
            <DossierNo no={dossierNo} label="报告档号" />
            <Typography.Text code>{report.report_id}</Typography.Text>
            <Typography.Text type="secondary">{formatTime(report.created_at)}</Typography.Text>
            <ModeBadge mode={ov.mode} size="sm" />
            <SimBadge compact />
            <Tag style={{ margin: 0 }}>只读快照</Tag>
          </Space>
        }
        extra={
          <Flex data-tour="report-export" gap={8} align="center" wrap>
            <Button icon={<ArrowLeft size={15} />} onClick={() => navigate('/reports')}>报告中心</Button>
            <Button icon={<Share2 size={15} />} loading={shareMutation.isPending} onClick={() => shareMutation.mutate()}>分享</Button>
            <Button type="primary" icon={<Download size={15} />} loading={pdfMutation.isPending} onClick={() => pdfMutation.mutate()}>导出 PDF</Button>
          </Flex>
        }
      />

      <div className="bb-report-grid" style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <nav className="bb-report-nav" aria-label="报告章节" style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SECTIONS.map((s) => (
            <Button
              key={s.id}
              type={active === s.id ? 'link' : 'text'}
              icon={<s.icon size={14} strokeWidth={1.5} />}
              aria-current={active === s.id ? 'location' : undefined}
              onClick={() => scrollTo(s.id)}
              style={{ justifyContent: 'flex-start' }}
            >
              {s.label}
            </Button>
          ))}
          <Typography.Text type="secondary" style={{ marginTop: 8 }}>
            <InfoCircleOutlined /> 报告生成后不再随实例变化而改变，重新生成将产生新报告。
          </Typography.Text>
        </nav>

        <Flex data-tour="report-body" vertical gap={16} style={{ minWidth: 0 }}>
          <Part1 content={content} />
          <Part2 content={content} />
          <Part3 content={content} />
          <Part4 content={content} />
          <Part5 content={content} />
          <Part6 content={content} />
        </Flex>
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} url={shareMutation.data ? `${window.location.origin}${shareMutation.data.share_url}` : ''} expiresAt={shareMutation.data?.expires_at} />
    </div>
  );
}

function PartAnchor({ id, title, icon, extra, children }: { id: string; title: string; icon: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card
      id={id}
      size="small"
      variant="borderless"
      style={{ scrollMarginTop: 16, borderRadius: 8 }}
      styles={{ header: { padding: '8px 16px' }, body: { padding: 16 } }}
      title={<Space size={8}>{icon}{title}</Space>}
      extra={extra}
    >
      {children}
    </Card>
  );
}

function Part1({ content }: { content: ReportContent }) {
  const ov = content.part1_overview;
  const rc = content.rootcause_summary;
  return (
    <PartAnchor id="part1" title="测评概要" icon={<FileBarChart size={15} />}>
      <Descriptions bordered={false} column={1} size="small">
        <Descriptions.Item label="声明用途">{ov.purpose || '未标注用途的自定义 Agent'}</Descriptions.Item>
        <Descriptions.Item label="防护状态"><Tag style={{ margin: 0 }}>{ov.guard_enabled ? '防护开启' : '防护关闭（对照）'}</Tag></Descriptions.Item>
        <Descriptions.Item label="会话"><Typography.Text code>{ov.session_id}</Typography.Text></Descriptions.Item>
        <Descriptions.Item label="累计风险"><Typography.Text title={`累计风险分 ${ov.risk_score.toFixed(2)}`}>{ov.risk_score.toFixed(1)}</Typography.Text></Descriptions.Item>
        <Descriptions.Item label="回合">{ov.turns}</Descriptions.Item>
        <Descriptions.Item label="工具调用">{ov.call_count}</Descriptions.Item>
        <Descriptions.Item label="拦截">{ov.block_count}</Descriptions.Item>
        <Descriptions.Item label="质询">{ov.challenge_count}</Descriptions.Item>
        <Descriptions.Item label="限额拦截">{ov.limit_block_count}</Descriptions.Item>
        <Descriptions.Item label="最高风险"><Tag style={{ margin: 0 }} color={ov.max_risk === 'high' ? 'error' : ov.max_risk === 'medium' ? 'warning' : 'default'}>{RISK_META[ov.max_risk]?.label ?? ov.max_risk}</Tag></Descriptions.Item>
        <Descriptions.Item label="结论">{ov.conclusion}</Descriptions.Item>
      </Descriptions>
      {rc.dominant && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>根因分布 · 主导：{rc.dominant}</Typography.Text>
          <CategoryBars counts={rc.category_counts} />
        </div>
      )}
    </PartAnchor>
  );
}

function Part2({ content }: { content: ReportContent }) {
  const b = content.part2_baseline;
  const grouped = useMemo(() => {
    const g: Record<string, Policy[]> = { L1: [], L2: [], L3: [] };
    for (const p of b.policies) (g[p.level] ||= []).push(p);
    return g;
  }, [b.policies]);
  return (
    <PartAnchor
      id="part2"
      title="靶标基线快照"
      icon={<ScrollText size={15} />}
      extra={<Tag style={{ margin: 0 }}>快照 v{b.policy_snapshot_version ?? '—'} · {b.policies.length} 条策略</Tag>}
    >
      <pre className="mono" style={baselinePreStyle}>{b.baseline_summary}</pre>
      <Flex gap={8} wrap align="center" style={{ margin: '16px 0' }}>
        <Space size={8}>防护档位 <PresetTag preset={b.config.guard.preset} /></Space>
        <Tag style={{ margin: 0 }}>单轮 ≤ {b.config.limits.max_calls_per_turn}</Tag>
        <Tag style={{ margin: 0 }}>会话 ≤ {b.config.limits.max_calls_per_session}</Tag>
        <Tag style={{ margin: 0 }}>超时 {b.config.limits.timeout_ms}ms</Tag>
      </Flex>
      <Collapse ghost items={[{
        key: 'policies',
        label: `策略清单（${b.policies.length}）`,
        styles: { header: { padding: '8px 0' }, body: { padding: 0 } },
        children: (
          <Flex vertical gap={16}>
            {(['L1', 'L2', 'L3'] as const).map((lv) => grouped[lv]?.length ? (
              <Descriptions key={lv} title={`${lv} · ${grouped[lv].length} 条`} bordered={false} column={1} size="small">
                {grouped[lv].map((p) => (
                  <Descriptions.Item key={p.policy_id} label={<Typography.Text code>{p.policy_id}</Typography.Text>}>
                    <Flex gap={8} wrap align="center">
                      <Typography.Text>{p.condition}</Typography.Text>
                      <StatusBadge action={p.action} size="sm" />
                      {!p.enabled && <Tag style={{ margin: 0 }}>停用</Tag>}
                      {p.origin === 'manual' && <Tag color="warning" style={{ margin: 0 }}>人工</Tag>}
                    </Flex>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ) : null)}
          </Flex>
        ),
      }]} />
    </PartAnchor>
  );
}

function Part3({ content }: { content: ReportContent }) {
  const seq = content.part3_attack_sequence;
  return (
    <PartAnchor id="part3" title="攻击序列" icon={<AttackIcon size={15} />} extra={<Tag style={{ margin: 0 }}>{seq.length} 回合</Tag>}>
      <List
        dataSource={seq}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次会话无对话回合" /> }}
        renderItem={(t) => (
          <List.Item key={t.turn} style={{ display: 'block', padding: '16px 0' }}>
            <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
              <Tag style={{ margin: 0 }}>T{t.turn}</Tag>
              <Space size={8}>
                {t.actor === 'redteam' ? <AttackIcon size={14} /> : <User size={14} />}
                {t.actor === 'redteam' ? '红队' : '业务用户'}
              </Space>
              {t.source_sample_id && <Tag color="warning" style={{ margin: 0 }}>样本 {t.source_sample_id}</Tag>}
              <Typography.Text type="secondary">{t.calls.length} 次调用</Typography.Text>
            </Flex>
            <div style={bubbleStyle}>
              <Typography.Text type="secondary">输入</Typography.Text>
              <div style={{ marginTop: 8 }}>{t.input}</div>
            </div>
            <div style={{ ...bubbleStyle, marginTop: 8 }}>
              <Typography.Text type="secondary"><Space size={8}><Bot size={14} />Agent 回复</Space></Typography.Text>
              <div style={{ marginTop: 8 }}>{t.agent_reply || '（无文本回复）'}</div>
            </div>
            {t.calls.length > 0 && (
              <Descriptions bordered={false} column={1} size="small" style={{ marginTop: 16 }}>
                {t.calls.map((c) => (
                  <Descriptions.Item key={c.call_id} label={<Space size={8} wrap><Typography.Text code>{c.tool}</Typography.Text><Typography.Text type="secondary">{TOOL_META[c.tool]?.label}</Typography.Text></Space>}>
                    <Flex gap={8} wrap align="center">
                      <Typography.Text title={c.reason}>{truncate(c.reason, 60)}</Typography.Text>
                      <StatusBadge action={c.action} size="sm" />
                      <Typography.Text type="secondary">{formatDuration(c.duration_ms)}</Typography.Text>
                    </Flex>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
          </List.Item>
        )}
      />
    </PartAnchor>
  );
}

function Part4({ content }: { content: ReportContent }) {
  const items = content.part4_risk_analysis;
  return (
    <PartAnchor id="part4" title="风险分析" icon={<AlertTriangle size={15} />} extra={<Tag style={{ margin: 0 }}>{items.length} 条告警</Tag>}>
      <List
        dataSource={items}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次测评未触发风险告警，链路全绿。" /> }}
        renderItem={(a) => (
          <List.Item key={a.alert_id} style={{ display: 'block', padding: '16px 0' }}>
            <Descriptions bordered={false} column={1} size="small" title={a.label}>
              <Descriptions.Item label="判定">
                <Space size={8} wrap>
                  <Tag color={a.level === 'high' ? 'error' : a.level === 'medium' ? 'warning' : 'default'} style={{ margin: 0 }}>{RISK_META[a.level]?.label ?? a.level}</Tag>
                  {a.boundary && <Tag style={{ margin: 0 }}>{BOUNDARY_META[a.boundary]}</Tag>}
                  <StatusBadge action={a.action} size="sm" />
                  <Typography.Text type="secondary">T{a.turn}</Typography.Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="原因">{a.reason}</Descriptions.Item>
              <Descriptions.Item label="根因">
                {a.evidence_insufficient ? (
                  <Typography.Text type="secondary"><InfoCircleOutlined /> 证据不足，建议人工复核后再归类</Typography.Text>
                ) : (
                  <Space size={8} wrap>
                    {a.root_causes.map((c, i) => <Tag key={i} style={{ margin: 0 }}>{c.name ?? CATEGORY_NAMES[c.category] ?? c.category}</Tag>)}
                    {a.root_cause && a.root_causes.length === 0 && <Tag style={{ margin: 0 }}>{a.root_cause}</Tag>}
                  </Space>
                )}
              </Descriptions.Item>
              {(a.false_positive || a.false_negative) && (
                <Descriptions.Item label="人工标记">
                  <Space size={8} wrap>
                    {a.false_positive && <Tag color="error" style={{ margin: 0 }}>已标误报</Tag>}
                    {a.false_negative && <Tag color="warning" style={{ margin: 0 }}>已标漏报</Tag>}
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>
          </List.Item>
        )}
      />
    </PartAnchor>
  );
}

function Part5({ content }: { content: ReportContent }) {
  const suggestions = content.part5_hardening;
  const grouped = useMemo(() => {
    const g: Record<string, HardeningSuggestion[]> = { immediate: [], tooling: [], tradeoff: [] };
    for (const s of suggestions) (g[s.kind] ||= []).push(s);
    return g;
  }, [suggestions]);
  return (
    <PartAnchor id="part5" title="加固建议" icon={<Wrench size={15} />} extra={<Tag style={{ margin: 0 }}>{suggestions.length} 项</Tag>}>
      <Flex vertical gap={16}>
        {(['immediate', 'tooling', 'tradeoff'] as const).map((kind) => grouped[kind]?.length ? (
          <div key={kind}>
            <Space size={8} wrap>
              <Typography.Text strong>{KIND_META[kind].label}</Typography.Text>
              <Typography.Text type="secondary">{KIND_META[kind].desc} · {grouped[kind].length} 项</Typography.Text>
            </Space>
            <List dataSource={grouped[kind]} renderItem={(s, i) => (
              <List.Item key={i} style={{ display: 'block', padding: '16px 0' }}>
                <Descriptions bordered={false} column={1} size="small">
                  <Descriptions.Item label="建议"><Typography.Text strong>{s.action}</Typography.Text></Descriptions.Item>
                  <Descriptions.Item label="预期">{s.expected_effect}</Descriptions.Item>
                  {s.cost && <Descriptions.Item label="代价">{s.cost}</Descriptions.Item>}
                  {s.category_name && <Descriptions.Item label="分类"><Tag style={{ margin: 0 }}>{s.category_name}</Tag></Descriptions.Item>}
                </Descriptions>
              </List.Item>
            )} />
          </div>
        ) : null)}
      </Flex>
    </PartAnchor>
  );
}

function Part6({ content }: { content: ReportContent }) {
  const longNote = content.simulation_note.length > 120 || content.simulation_note.includes('\n');
  return (
    <PartAnchor id="part6" title="局限性说明" icon={<Info size={15} />}>
      <List dataSource={content.part6_limitations} renderItem={(item, i) => (
        <List.Item key={i} style={{ padding: '8px 0' }}><Typography.Text>{i + 1}. {item}</Typography.Text></List.Item>
      )} />
      {longNote ? (
        <Collapse ghost style={{ marginTop: 16 }} items={[{
          key: 'simulation',
          label: <Typography.Text type="secondary"><InfoCircleOutlined /> 模拟环境说明</Typography.Text>,
          styles: { header: { padding: '8px 0' }, body: { padding: 0 } },
          children: <Typography.Paragraph type="secondary" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{content.simulation_note}</Typography.Paragraph>,
        }]} />
      ) : (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}><InfoCircleOutlined /> {content.simulation_note}</Typography.Text>
      )}
    </PartAnchor>
  );
}

function CategoryBars({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (entries.length === 0) return null;
  return (
    <Descriptions bordered={false} column={1} size="small" style={{ marginTop: 8 }}>
      {entries.map(([cat, n]) => (
        <Descriptions.Item key={cat} label={CATEGORY_NAMES[cat] ?? cat}>
          <Flex align="center" gap={8} style={{ width: '100%' }}>
            <Progress percent={(n / max) * 100} strokeColor="var(--bb-brand-primary)" showInfo={false} size="small" />
            <Typography.Text>{n}</Typography.Text>
          </Flex>
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function ShareModal({ open, onClose, url, expiresAt }: { open: boolean; onClose: () => void; url: string; expiresAt?: string }) {
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      message.success('分享链接已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      message.error('复制失败，请手动复制分享链接');
    }
  };
  return (
    <Modal open={open} title="只读分享链接" onCancel={onClose} footer={<Button type="primary" onClick={onClose}>完成</Button>} width={520} centered>
      <Flex vertical gap={16} style={{ paddingTop: 8 }}>
        <Typography.Text>任何持有此链接的人无需登录即可查看报告（只读）。链接到期后自动失效。</Typography.Text>
        <Flex gap={8}>
          <Input aria-label="只读分享链接" value={url} readOnly />
          <Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>{copied ? '已复制' : '复制'}</Button>
        </Flex>
        {expiresAt && <Typography.Text type="secondary">有效期至 {formatTime(expiresAt)}</Typography.Text>}
      </Flex>
    </Modal>
  );
}

const bubbleStyle: CSSProperties = { padding: 16, background: 'var(--bb-bg-subtle)', border: '1px solid var(--bb-border)', borderRadius: 8, color: 'var(--bb-text-1)', lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const baselinePreStyle: CSSProperties = { ...bubbleStyle, margin: 0, fontSize: 13, maxHeight: 320, overflowY: 'auto' };
