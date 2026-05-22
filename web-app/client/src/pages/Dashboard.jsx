import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

export default function Dashboard() {
  const [tables, setTables] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLogs, setSyncLogs] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [tablesData, statusData, logsData] = await Promise.allSettled([
        api.getTables(),
        api.getSyncStatus(),
        api.getSyncLog({ limit: 5 })
      ]);

      if (tablesData.status === 'fulfilled') setTables(tablesData.value);
      if (statusData.status === 'fulfilled') setSyncStatus(statusData.value);
      if (logsData.status === 'fulfilled') setSyncLogs(logsData.value);

      // If all failed, show error
      if (tablesData.status === 'rejected' && statusData.status === 'rejected') {
        setError(tablesData.reason?.message || 'Failed to load data');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;
  if (error && !tables && !syncStatus) return <ErrorMessage message={error} onRetry={loadData} />;

  const totalRows = tables?.tables?.reduce((sum, t) => sum + t.row_count, 0) || 0;
  const totalTables = tables?.total || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <button onClick={loadData} className="btn-secondary text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Tables"
          value={totalTables}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          }
          color="blue"
          link="/tables"
        />
        <SummaryCard
          title="Total Rows"
          value={totalRows.toLocaleString()}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          }
          color="green"
        />
        <SummaryCard
          title="Sync Status"
          value={<StatusBadge status={syncStatus?.sync_status} />}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
          color="yellow"
          link="/sync"
        />
        <SummaryCard
          title="Last Sync"
          value={syncStatus?.last_sync_time ? formatTime(syncStatus.last_sync_time) : 'Never'}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="purple"
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Sync Log */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Sync Activity</h2>
            <Link to="/sync" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              View All &rarr;
            </Link>
          </div>

          {syncLogs?.logs?.length > 0 ? (
            <div className="space-y-3">
              {syncLogs.logs.map((log, i) => (
                <div key={log.id || i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {log.tables_synced || 0} tables synced
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDateTime(log.started_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={log.status} />
                    {log.duration_seconds && (
                      <p className="text-xs text-gray-500 mt-1">{log.duration_seconds}s</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">No sync activity yet</p>
          )}
        </div>

        {/* Top Tables by Row Count */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Largest Tables</h2>
            <Link to="/tables" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              View All &rarr;
            </Link>
          </div>

          {tables?.tables?.length > 0 ? (
            <div className="space-y-2">
              {[...tables.tables]
                .sort((a, b) => b.row_count - a.row_count)
                .slice(0, 8)
                .map(t => {
                  const maxRows = tables.tables.reduce((m, tt) => Math.max(m, tt.row_count), 1);
                  const pct = Math.max(2, (t.row_count / maxRows) * 100);
                  return (
                    <Link
                      key={t.name}
                      to={`/tables/${encodeURIComponent(t.name)}`}
                      className="flex items-center gap-3 py-1.5 group"
                    >
                      <span className="text-sm font-mono text-gray-700 w-24 truncate group-hover:text-blue-600">
                        {t.name}
                      </span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-16 text-right">
                        {t.row_count.toLocaleString()}
                      </span>
                    </Link>
                  );
                })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">No tables synced yet</p>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">
            Some data could not be loaded: {error}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, icon, color, link }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600'
  };

  const content = (
    <div className="card hover:shadow-md transition-shadow cursor-default">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{title}</p>
          <div className="text-2xl font-bold text-gray-900">{value}</div>
        </div>
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );

  if (link) {
    return <Link to={link}>{content}</Link>;
  }
  return content;
}

function formatTime(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function formatDateTime(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString();
}
