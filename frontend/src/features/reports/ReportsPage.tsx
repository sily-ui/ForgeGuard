import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Segmented, Spin, Tag, Tooltip } from 'antd';
import {
  FileBarChart,
  Search,
  Clock,
  Share2,
  ArrowRight,
  LayoutGrid,
  List,
  FileText,
} from 'lucide-react';
import { GuardIcon } from '@/components/icons/SecurityIcons';
import { reportApi } from '@/services/api/resources';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { EmptyState } from '@/components/common/EmptyState';
import { RiskRing } from '@/components/common/RiskRing';
import { RISK_META } from '@/utils/constants';
import { formatShort, fromNow, truncate } from '@/utils/format';
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
          <div data-tour="reports-header" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="primary" icon={<FileText size={15} />} onClick={() => navigate('/instances')}>
              从会话生成报告
            </Button>
          </div>
        }
      />

      <div data-tour="reports-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
        <StatCard label="报告总数" value={stats.total} />
        <StatCard label="累计拦截" value={stats.blocked} color="var(--fg-allow-text)" />
        <StatCard label="高危报告" value={stats.high} color="var(--fg-block-text)" />
      </div>

      <div data-tour="reports-list">
      <SectionCard
        title={`报告列表 · ${filtered.length}`}
        extra={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              allowClear
              size="small"
              placeholder="搜索靶标 / 结论 / 编号"
              prefix={<Search size={13} style={{ color: 'var(--fg-text-3)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 200 }}
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
                { label: <LayoutGrid size={14} />, value: 'card' },
                { label: <List size={14} />, value: 'table' },
              ]}
            />
          </div>
        }
        padding={view === 'card' ? 16 : 0}
      >
        {reportsQuery.isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileBarChart size={22} />}
            title={reports.length === 0 ? '还没有测评报告' : '没有匹配的报告'}
            description={reports.length === 0 ? '进入攻防控制台完成一轮测评后，点击「生成报告」即可产出只读快照报告。' : '调整搜索或筛选条件'}
            actionLabel={reports.length === 0 ? '前往实例管理' : undefined}
            onAction={reports.length === 0 ? () => navigate('/instances') : undefined}
          />
        ) : view === 'card' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {filtered.map((r) => (
              <ReportCard key={r.report_id} report={r} onOpen={() => navigate(`/reports/${r.report_id}`)} />
            ))}
          </div>
        ) : (
          <ReportTable reports={filtered} onOpen={(id) => navigate(`/reports/${id}`)} />
        )}
      </SectionCard>
      </div>
    </div>
  );
}

function ReportCard({ report, onOpen }: { report: Report; onOpen: () => void }) {
  const s = report.summary;
  const high = s.max_risk === 'high';
  return (
    <button onClick={onOpen} style={reportCardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <RiskRing score={high ? 0.9 : s.max_risk === 'medium' ? 0.5 : 0.15} maxRisk={s.max_risk} size={46} stroke={5} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.instance_name}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--fg-text-3)', marginTop: 2 }}>{report.report_id}</div>
        </div>
        <Tag color={high ? 'error' : s.max_risk === 'medium' ? 'warning' : 'success'} style={{ margin: 0 }}>
          {RISK_META[s.max_risk]?.label ?? s.max_risk}
        </Tag>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-text-2)', lineHeight: 1.6, margin: '12px 0', minHeight: 38 }}>
        {truncate(s.conclusion, 76)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--fg-text-3)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <GuardIcon size={12} style={{ color: 'var(--fg-allow-text)' }} /> 拦截 <b className="mono" style={{ color: 'var(--fg-text-2)' }}>{s.block_count}</b>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> {s.turns} 回合
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {report.share_expires_at && (
            <Tooltip title={`分享链接有效期至 ${formatShort(report.share_expires_at)}`}>
              <Share2 size={12} style={{ color: 'var(--fg-brand-primary)' }} />
            </Tooltip>
          )}
          {fromNow(report.created_at)}
          <ArrowRight size={13} />
        </span>
      </div>
    </button>
  );
}

function ReportTable({ reports, onOpen }: { reports: Report[]; onOpen: (id: string) => void }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: 'var(--fg-bg-subtle)', textAlign: 'left' }}>
            {['靶标', '最高风险', '拦截', '回合', '结论', '生成时间', ''].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.report_id} style={{ borderBottom: '1px solid var(--fg-border)', cursor: 'pointer' }} onClick={() => onOpen(r.report_id)}>
              <td style={tdStyle}>
                <div style={{ fontWeight: 600, color: 'var(--fg-text-1)' }}>{r.summary.instance_name}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--fg-text-3)' }}>{r.report_id}</div>
              </td>
              <td style={tdStyle}>
                <Tag color={r.summary.max_risk === 'high' ? 'error' : r.summary.max_risk === 'medium' ? 'warning' : 'success'} style={{ margin: 0 }}>
                  {RISK_META[r.summary.max_risk]?.label ?? r.summary.max_risk}
                </Tag>
              </td>
              <td style={tdStyle}><span className="mono" style={{ color: 'var(--fg-allow-text)', fontWeight: 600 }}>{r.summary.block_count}</span></td>
              <td style={tdStyle}><span className="mono">{r.summary.turns}</span></td>
              <td style={{ ...tdStyle, maxWidth: 320, color: 'var(--fg-text-2)' }}>{truncate(r.summary.conclusion, 50)}</td>
              <td style={{ ...tdStyle, color: 'var(--fg-text-3)', whiteSpace: 'nowrap' }}>{formatShort(r.created_at)}</td>
              <td style={tdStyle}><ArrowRight size={14} style={{ color: 'var(--fg-text-3)' }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="fg-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px' }}>
      <span style={{ fontSize: 12, color: 'var(--fg-text-3)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: color ?? 'var(--fg-text-1)', lineHeight: 1 }}>{value}</span>
    </div>
  );
}

const reportCardStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: 16,
  background: 'var(--fg-bg-card)',
  border: '1px solid var(--fg-border)',
  borderRadius: 12,
  cursor: 'pointer',
  transition: 'border-color 160ms ease, background-color 160ms ease',
  width: '100%',
};
const thStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 11, fontWeight: 500, color: 'var(--fg-text-3)', borderBottom: '1px solid var(--fg-border)' };
const tdStyle: React.CSSProperties = { padding: '11px 14px', verticalAlign: 'middle' };