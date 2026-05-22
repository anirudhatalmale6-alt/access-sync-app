import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

export default function SyncMonitor() {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState(null);
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, logsData] = await Promise.all([
        api.getSyncStatus(),
        api.getSyncLog({ page, limit: 20 })
      ]);
      setStatus(statusData);
      setLogs(logsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 10s when sync is running
  useEffect(() => {
    if (status?.sync_status === 'running') {
      const interval = setInterval(loadData, 10000);
      return () => clearInterval(interval);
    }
  }, [status?.sync_status, loadData]);

  async function handleTriggerSync() {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const result = await api.triggerSync();
      setTriggerMsg({ type: 'success', text: result.message || 'Sync triggered' });
      // Reload after brief delay
      setTimeout(loadData, 1500);
    } catch (err) {
      setTriggerMsg({ type: 'error', text: err.message });
    } finally {
      setTriggering(false);
    }
  }

  if (loading && !logs) return <LoadingSpinner message="Loading sync data..." />;
  if (error && !status) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sync Monitor</h1>
        <button onClick={loadData} className="btn-secondary text-sm">
          Refresh
        </button>
      </div>

      {/* Status Card */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">Status</p>
            <StatusBadge status={status?.sync_status} />
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Last Sync</p>
            <p className="text-sm font-medium">
              {status?.last_sync_time
                ? new Date(status.last_sync_time).toLocaleString()
                : 'Never'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Next Sync</p>
            <p className="text-sm font-medium">
              {status?.next_sync_time
                ? new Date(status.next_sync_time).toLocaleString()
                : 'Not scheduled'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Error Count</p>
            <p className={`text-sm font-medium ${status?.sync_error_count > 0 ? 'text-red-600' : ''}`}>
              {status?.sync_error_count || 0}
            </p>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200 flex items-center gap-4">
          <button
            onClick={handleTriggerSync}
            disabled={triggering || status?.sync_status === 'running'}
            className="btn-primary flex items-center gap-2"
          >
            {triggering ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {triggering ? 'Triggering...' : 'Trigger Sync Now'}
          </button>

          <p className="text-sm text-gray-500">
            Interval: every {status?.sync_interval_minutes || '?'} minutes
          </p>
        </div>

        {triggerMsg && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            triggerMsg.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {triggerMsg.text}
          </div>
        )}
      </div>

      {/* Sync Log Table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Sync History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Status</th>
                <th>Tables</th>
                <th>Rows</th>
                <th>Duration</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {!logs?.logs?.length ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    No sync history available
                  </td>
                </tr>
              ) : (
                logs.logs.map((log, i) => (
                  <tr key={log.id || i}>
                    <td className="text-gray-400">{log.id}</td>
                    <td className="text-xs">{log.started_at ? new Date(log.started_at).toLocaleString() : '-'}</td>
                    <td className="text-xs">{log.completed_at ? new Date(log.completed_at).toLocaleString() : '-'}</td>
                    <td><StatusBadge status={log.status} /></td>
                    <td>{log.tables_synced || 0}</td>
                    <td>{(log.rows_synced || 0).toLocaleString()}</td>
                    <td>{log.duration_seconds ? `${log.duration_seconds}s` : '-'}</td>
                    <td className="max-w-xs truncate text-red-600" title={log.errors || ''}>
                      {log.errors || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {logs?.pagination && (
          <div className="px-4 pb-4">
            <Pagination
              page={logs.pagination.page}
              totalPages={logs.pagination.total_pages}
              total={logs.pagination.total}
              limit={logs.pagination.limit}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
