import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Empty, Flex, Space, Spin, Table, Tag, Tooltip, Typography, theme } from 'antd';
import {
  ArrowLeft,
  GitCompare,
  ExternalLink,
  ArrowRight,
  Equal,
  Diff,
} from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { experimentApi, sessionApi } from '@/services/api/resources';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Logo } from '@/components/common/Logo';
import { SimBadge } from '@/components/common/SimBadge';
import { DossierNo } from '@/components/common/DossierNo';
import { RISK_META, TOOL_META } from '@/utils/constants';
import { formatDuration, formatShort, paramsSummaryText, truncate } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { ExperimentCall, ExperimentRow, ExperimentRun, Session } from '@/types/api';

export default function ExperimentPage() {
  const { pairId = '' } = useParams();
  const navigate = useNavigate();
  const { token } = theme.useToken();

  const expQuery = useQuery({ queryKey: ['experiment', pairId], queryFn: () => experimentApi.get(pairId), enabled: !!pairId });
  const exp = expQuery.data;

  const sessionAQuery = useQuery({
    queryKey: ['session', exp?.run_a.session_id],
    queryFn: () => sessionApi.get(exp!.run_a.session_id),
    enabled: !!exp?.run_a.session_id,
  });
  const sessionBQuery = useQuery({
    queryKey: ['session', exp?.run_b.session_id],
    queryFn: () => sessionApi.get(exp!.run_b.session_id),
    enabled: !!exp?.run_b.session_id,
  });

  const diffSteps = useMemo(() => {
    if (!exp) return 0;
    return exp.rows.filter((r) => (r.run_a.action ?? null) !== (r.run_b.action ?? null)).length;
  }, [exp]);

  if (expQuery.isLoading) {
    return (
      <Flex vertical align="center" justify="center" gap={16} style={{ flex: 1 }}>
        <Logo size={48} />
        <Spin />
        <Typography.Text type="secondary">正在加载对照实验…</Typography.Text>
      </Flex>
    );
  }

  if (!exp) {
    return (
      <Flex align="center" justify="center" style={{ flex: 1 }}>
        <Empty description="对照实验不存在或已被清理">
          <Button type="primary" onClick={() => navigate('/instances')}>返回实例管理</Button>
        </Empty>
      </Flex>
    );
  }

  return (
    <>
      <Flex className="bb-lab-nav" align="center" justify="space-between" gap={16} wrap style={{ flexShrink: 0, padding: '8px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer }}>
        <Flex align="center" gap={16} wrap style={{ minWidth: 0 }}>
          <Button size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate(`/console/${exp.source_session_id}`)}>
            返回控制台
          </Button>
          <Logo size={24} />
          <Typography.Text>对照实验 / <Typography.Text code>{exp.pair_id}</Typography.Text></Typography.Text>
        </Flex>
        <Space size={8} wrap>
          <Tag style={{ margin: 0 }}>{exp.dimension === 'guard' ? '防护对照' : '实例对照'}</Tag>
          <SimBadge />
        </Space>
      </Flex>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        <Flex vertical gap={16} style={{ maxWidth: 1280, margin: '0 auto' }}>
          <Card
            data-tour="exp-summary"
            size="small"
            variant="borderless"
            style={{ borderRadius: 8 }}
            styles={{ header: { padding: '8px 16px' }, title: { whiteSpace: 'normal' }, body: { padding: 16 } }}
            title={<Space size={8}><GitCompare size={18} strokeWidth={1.5} />{exp.dimension === 'guard' ? '同一靶标 · 防护开关对照' : '同一输入 · 不同靶标对照'}</Space>}
          >
            <Descriptions bordered={false} column={1} size="small">
              <Descriptions.Item label="创建时间">{formatShort(exp.created_at)}</Descriptions.Item>
              <Descriptions.Item label="步骤">共 {exp.rows.length} 步 · {diffSteps} 步判定差异</Descriptions.Item>
              <Descriptions.Item label="判定对比"><Tag color={diffSteps > 0 ? 'warning' : 'success'} style={{ margin: 0 }}>{diffSteps > 0 ? `${diffSteps} 步差异` : '判定一致'}</Tag></Descriptions.Item>
              <Descriptions.Item label="对照输入">
                <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{exp.input || '（复用起点会话首轮输入）'}</Typography.Paragraph>
              </Descriptions.Item>
            </Descriptions>
            {exp.diff_items.length > 0 && (
              <Descriptions title="配置差异" bordered={false} column={1} size="small" style={{ marginTop: 16 }}>
                {exp.diff_items.map((d, i) => (
                  <Descriptions.Item key={i} label={<Typography.Text code>{d.field}</Typography.Text>}>
                    <Typography.Text className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{d.change}</Typography.Text>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
          </Card>

          <div data-tour="exp-runs" className="bb-exp-runs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <RunSummary label="A 组 · 起点" run={exp.run_a} session={sessionAQuery.data} loading={sessionAQuery.isLoading} onOpen={() => navigate(`/console/${exp.run_a.session_id}`)} />
            <RunSummary label="B 组 · 对照" run={exp.run_b} session={sessionBQuery.data} loading={sessionBQuery.isLoading} onOpen={() => navigate(`/console/${exp.run_b.session_id}`)} />
          </div>

          <Card
            data-tour="exp-rows"
            size="small"
            variant="borderless"
            style={{ borderRadius: 8, minWidth: 0 }}
            styles={{ header: { padding: '8px 16px' }, body: { padding: 16 } }}
            title={<Space size={8}><Diff size={16} strokeWidth={1.5} />逐步判定对比</Space>}
          >
            <Typography.Paragraph type="secondary" style={{ margin: '0 0 16px' }}>左 A 组 · 右 B 组，判定动作不一致的步骤高亮</Typography.Paragraph>
            <Table<ExperimentRow>
              size="small"
              rowKey="step"
              dataSource={exp.rows}
              pagination={false}
              scroll={{ x: 720 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="两组均未发生工具调用" /> }}
              onRow={(row) => ({ style: { background: (row.run_a.action ?? null) !== (row.run_b.action ?? null) ? token.colorWarningBg : token.colorBgContainer } })}
              columns={[
                { title: '步', dataIndex: 'step', key: 'step', width: 80, sorter: (a, b) => a.step - b.step, render: (step: number) => <Typography.Text className="mono">{String(step).padStart(2, '0')}</Typography.Text> },
                { title: 'A 组 · 起点', key: 'run_a', render: (_, row) => <CallCell call={row.run_a} /> },
                {
                  title: '判定',
                  key: 'difference',
                  width: 96,
                  align: 'center',
                  render: (_, row) => (row.run_a.action ?? null) !== (row.run_b.action ?? null)
                    ? <Tag color="warning" style={{ margin: 0 }}><Space size={8}><ArrowRight size={14} />差异</Space></Tag>
                    : <Typography.Text type="secondary"><Space size={8}><Equal size={14} />一致</Space></Typography.Text>,
                },
                { title: 'B 组 · 对照', key: 'run_b', render: (_, row) => <CallCell call={row.run_b} /> },
              ]}
            />
          </Card>
        </Flex>
      </div>
    </>
  );
}

function RunSummary({ label, run, session, loading, onOpen }: { label: string; run: ExperimentRun; session?: Session; loading: boolean; onOpen: () => void }) {
  return (
    <Card
      size="small"
      variant="borderless"
      title={label}
      extra={<Button size="small" type="text" icon={<ExternalLink size={13} />} onClick={onOpen}>控制台</Button>}
      style={{ borderRadius: 8, minWidth: 0 }}
      styles={{ header: { padding: '8px 16px' }, body: { padding: 16 } }}
    >
      <Descriptions bordered={false} column={1} size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="会话"><Typography.Text code style={{ overflowWrap: 'anywhere' }}>{run.session_id}</Typography.Text></Descriptions.Item>
        <Descriptions.Item label="档号"><DossierNo no={dossierFromId(run.session_id)} /></Descriptions.Item>
      </Descriptions>
      {loading ? (
        <div style={{ padding: '16px 0', textAlign: 'center' }}><Spin size="small" /></div>
      ) : !session ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="会话详情不可用" />
      ) : (
        <Descriptions bordered={false} column={1} size="small">
          <Descriptions.Item label="靶标"><Typography.Text strong>{session.instance_name}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="防护状态"><Tag color={session.guard_enabled ? 'success' : 'error'} style={{ margin: 0 }}><Space size={8}><GuardIcon size={14} />{session.guard_enabled ? '防护开启' : '防护关闭'}</Space></Tag></Descriptions.Item>
          <Descriptions.Item label="累计风险"><Typography.Text title={`累计风险分 ${session.risk_score.toFixed(2)}`}>{session.risk_score.toFixed(1)}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="调用">{session.call_count}</Descriptions.Item>
          <Descriptions.Item label="拦截">{session.block_count}</Descriptions.Item>
          <Descriptions.Item label="质询">{session.challenge_count}</Descriptions.Item>
          <Descriptions.Item label="最高风险"><Tag color={session.max_risk === 'high' ? 'error' : session.max_risk === 'medium' ? 'warning' : 'default'} style={{ margin: 0 }}>{RISK_META[session.max_risk]?.label ?? session.max_risk}</Tag></Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  );
}

function CallCell({ call }: { call: ExperimentCall }) {
  if (call.note || !call.tool) {
    return <Typography.Text type="secondary">{call.note ?? '本次运行未发生该步'}</Typography.Text>;
  }
  return (
    <Flex vertical gap={8}>
      <Space size={8} wrap>
        <Typography.Text code>{call.tool}</Typography.Text>
        <Typography.Text type="secondary">{TOOL_META[call.tool]?.label}</Typography.Text>
        <StatusBadge action={call.action ?? 'unknown'} size="sm" />
      </Space>
      <Tooltip title={paramsSummaryText(call.params_summary ?? {})}>
        <Typography.Text className="mono" style={{ overflowWrap: 'anywhere' }}>{truncate(paramsSummaryText(call.params_summary ?? {}), 40)}</Typography.Text>
      </Tooltip>
      <Space size={8} wrap>
        {call.risk && <Tag style={{ margin: 0 }} color={call.risk === 'high' ? 'error' : call.risk === 'medium' ? 'warning' : 'default'}>{RISK_META[call.risk]?.label ?? call.risk}</Tag>}
        {call.duration_ms != null && <Typography.Text type="secondary">{formatDuration(call.duration_ms)}</Typography.Text>}
      </Space>
    </Flex>
  );
}
