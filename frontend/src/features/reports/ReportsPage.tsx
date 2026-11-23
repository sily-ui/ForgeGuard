import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Empty, Flex, Input, Segmented, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import {
  FileBarChart,
  Search,
  Share2,
  ArrowRight,
  LayoutGrid,
  List,
  FileText,
} from 'lucide-react';
import { reportApi } from '@/services/api/resources';
import { PageHeader } from '@/components/common/PageHeader';
import { DossierNo } from '@/components/common/DossierNo';
import { RISK_META } from '@/utils/constants';
import { formatShort, fromNow, truncate } from '@/utils/format';
import { dossierFromId } from '@/utils/workspace';
import type { Report } from '@/types/api';

export default function ReportsPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [view, setView] = useState<'card' | 'table'>('card');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const reportsQuery = useQuery({ queryKey: ['reports'], queryFn: () => reportApi.list(undefined, 1, 200) });
  const reports = reportsQuery.data?.items ?? [];

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (riskFilter !== 'all' && r.summary.max_risk !== riskFilter) return false;
      if (keyword) {
        const hay = `${r.summary.instance_name} ${r.summary.conclusion} ${r.report_id} ${r.session_id}`.toLowerCase();
        if (!hay.includes(keyword.toLowerCase())) return false;
      }
      return true;
    });
  }, [reports, keyword, riskFilter]);

  const stats = useMemo(() => {
    const blocked = reports.reduce((s, r) => s + r.summary.block_count, 0);
    const high = reports.filter((r) => r.summary.max_risk === 'high').length;
    return { total: reports.length, blocked, high };
  }, [reports]);

  return (
    <div>
      <PageHeader
        icon={<FileBarChart size={20} strokeWidth={1.5} />}
        title="测评报告"
        subtitle="只读快照报告：测评概要 / 靶标基线 / 攻击序列 / 风险分析 / 加固建议 / 局限性说明"
        extra={
          <Flex data-tour="reports-header" gap={8} align="center" wrap>
            <Button type="primary" icon={<FileText size={15} />} onClick={() => navigate('/instances')}>
              从会话生成报告
            </Button>
          </Flex>
        }
      />

      <Card data-tour="reports-stats" size="small" variant="borderless" style={{ borderRadius: 8, marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
        <Descriptions bordered={false} size="small" column={1}>
          <Descriptions.Item label="报告总数">{stats.total}</Descriptions.Item>
          <Descriptions.Item label="累计拦截">{stats.blocked}</Descriptions.Item>
          <Descriptions.Item label="高危报告">{stats.high}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        data-tour="reports-list"
        size="small"
        variant="borderless"
        title={`报告列表 · ${filtered.length}`}
        style={{ borderRadius: 8 }}
        styles={{ header: { padding: '8px 16px' }, body: { padding: 16 } }}
      >
        <Flex vertical gap={16}>
          <Flex gap={8} align="center" wrap>
            <Input
              allowClear
              size="small"
              aria-label="搜索报告"
              placeholder="搜索靶标 / 结论 / 编号"
              prefix={<Search size={13} style={{ color: 'var(--bb-text-3)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 240, maxWidth: '100%' }}
            />
            <Segmented
              size="small"
              value={riskFilter}
              onChange={(v) => setRiskFilter(v as string)}
              options={[
                { label: '全部', value: 'all' },
                { label: '高危', value: 'high' },
                { label: '中危', value: 'medium' },
                { label: '低危', value: 'low' },
              ]}
            />
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as 'card' | 'table')}
              options={[
                { label: <LayoutGrid size={14} aria-label="卡片视图" />, title: '卡片视图', value: 'card' },
                { label: <List size={14} aria-label="表格视图" />, title: '表格视图', value: 'table' },
              ]}
            />
          </Flex>
          {reportsQuery.isLoading ? (
            <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>
          ) : filtered.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Flex vertical gap={8}>
                  <Typography.Text>{reports.length === 0 ? '还没有测评报告' : '没有匹配的报告'}</Typography.Text>
                  <Typography.Text type="secondary">{reports.length === 0 ? '进入攻防控制台完成一轮测评后，点击「生成报告」即可产出只读快照报告。' : '调整搜索或筛选条件'}</Typography.Text>
                </Flex>
              }
            >
              {reports.length === 0 && <Button type="primary" onClick={() => navigate('/instances')}>前往实例管理</Button>}
            </Empty>
          ) : view === 'card' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 16 }}>
              {filtered.map((r) => <ReportCard key={r.report_id} report={r} onOpen={() => navigate(`/reports/${r.report_id}`)} />)}
            </div>
          ) : (
            <ReportTable reports={filtered} onOpen={(id) => navigate(`/reports/${id}`)} />
          )}
        </Flex>
      </Card>
    </div>
  );
}

function ReportCard({ report, onOpen }: { report: Report; onOpen: () => void }) {
  const s = report.summary;
  return (
    <Card
      size="small"
      variant="borderless"
      hoverable
      role="button"
      tabIndex={0}
      aria-label={`查看报告：${s.instance_name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      style={{ borderRadius: 8, minWidth: 0 }}
      styles={{ body: { padding: 16 } }}
    >
      <Flex vertical gap={16}>
        <Flex align="start" justify="space-between" gap={8}>
          <Flex vertical gap={8} style={{ minWidth: 0 }}>
            <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{s.instance_name}</Typography.Text>
            <Typography.Text type="secondary" className="mono" style={{ overflowWrap: 'anywhere' }}>{report.report_id}</Typography.Text>
            <DossierNo no={dossierFromId(report.report_id)} />
          </Flex>
          <Tag color={s.max_risk === 'high' ? 'error' : s.max_risk === 'medium' ? 'warning' : 'success'} style={{ margin: 0 }}>
            {RISK_META[s.max_risk]?.label ?? s.max_risk}
          </Tag>
        </Flex>
        <Typography.Paragraph style={{ margin: 0 }}>{truncate(s.conclusion, 76)}</Typography.Paragraph>
        <Descriptions bordered={false} column={1} size="small">
          <Descriptions.Item label="拦截">{s.block_count}</Descriptions.Item>
          <Descriptions.Item label="回合">{s.turns}</Descriptions.Item>
        </Descriptions>
        <Flex gap={8} justify="space-between" align="center" wrap>
          <Typography.Text type="secondary">{fromNow(report.created_at)}</Typography.Text>
          <Space size={8}>
            {report.share_expires_at && (
              <Tooltip title={`分享链接有效期至 ${formatShort(report.share_expires_at)}`}>
                <Typography.Text type="secondary"><Space size={8}><Share2 size={14} />已分享</Space></Typography.Text>
              </Tooltip>
            )}
            <ArrowRight size={14} aria-hidden />
          </Space>
        </Flex>
      </Flex>
    </Card>
  );
}

function ReportTable({ reports, onOpen }: { reports: Report[]; onOpen: (id: string) => void }) {
  return (
    <Table<Report>
      size="small"
      rowKey="report_id"
      dataSource={reports}
      pagination={false}
      scroll={{ x: 960 }}
      onRow={(report) => ({ onClick: () => onOpen(report.report_id), style: { cursor: 'pointer' } })}
      columns={[
        {
          title: '靶标',
          key: 'instance',
          width: 240,
          render: (_, r) => (
            <Flex vertical gap={8}>
              <Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={(event) => { event.stopPropagation(); onOpen(r.report_id); }}>{r.summary.instance_name}</Button>
              <Typography.Text type="secondary" className="mono" style={{ overflowWrap: 'anywhere' }}>{r.report_id}</Typography.Text>
              <DossierNo no={dossierFromId(r.report_id)} />
            </Flex>
          ),
        },
        {
          title: '最高风险',
          key: 'risk',
          width: 120,
          render: (_, r) => <Tag color={r.summary.max_risk === 'high' ? 'error' : r.summary.max_risk === 'medium' ? 'warning' : 'success'} style={{ margin: 0 }}>{RISK_META[r.summary.max_risk]?.label ?? r.summary.max_risk}</Tag>,
        },
        { title: '拦截', key: 'blocks', width: 88, sorter: (a, b) => a.summary.block_count - b.summary.block_count, render: (_, r) => r.summary.block_count },
        { title: '回合', key: 'turns', width: 88, sorter: (a, b) => a.summary.turns - b.summary.turns, render: (_, r) => r.summary.turns },
        { title: '结论', key: 'conclusion', render: (_, r) => <Typography.Text title={r.summary.conclusion}>{truncate(r.summary.conclusion, 50)}</Typography.Text> },
        { title: '生成时间', dataIndex: 'created_at', key: 'created_at', width: 160, sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(), render: (value: string) => <Typography.Text type="secondary">{formatShort(value)}</Typography.Text> },
        { title: '操作', key: 'open', width: 64, render: (_, r) => <Button type="text" aria-label={`查看报告：${r.summary.instance_name}`} icon={<ArrowRight size={14} />} onClick={(event) => { event.stopPropagation(); onOpen(r.report_id); }} /> },
      ]}
    />
  );
}
