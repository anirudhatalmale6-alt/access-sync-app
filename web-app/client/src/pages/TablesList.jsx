import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

export default function TablesList() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  async function loadTables() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getTables();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTables(); }, []);

  const filtered = useMemo(() => {
    if (!data?.tables) return [];
    let list = data.tables;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (typeof va === 'string') {
        va = va.toLowerCase();
        vb = vb.toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [data, search, sortField, sortDir]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortArrow({ field }) {
    if (sortField !== field) return <span className="text-gray-300 ml-1">&uarr;</span>;
    return <span className="text-blue-600 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  if (loading) return <LoadingSpinner message="Loading tables..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadTables} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
        <span className="text-sm text-gray-500">{data?.total || 0} tables synced</span>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tables..."
          className="input pl-10"
        />
      </div>

      {/* Table grid */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} className="w-1/2">
                  Table Name <SortArrow field="name" />
                </th>
                <th onClick={() => toggleSort('row_count')} className="w-1/4">
                  Rows <SortArrow field="row_count" />
                </th>
                <th onClick={() => toggleSort('column_count')} className="w-1/4">
                  Columns <SortArrow field="column_count" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-8 text-gray-500">
                    {search ? 'No tables match your search' : 'No tables found'}
                  </td>
                </tr>
              ) : (
                filtered.map(t => (
                  <tr key={t.name}>
                    <td>
                      <Link
                        to={`/tables/${encodeURIComponent(t.name)}`}
                        className="text-blue-600 hover:text-blue-800 font-mono font-medium"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="font-mono">{t.row_count.toLocaleString()}</td>
                    <td className="font-mono">{t.column_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="text-sm text-gray-500">
          Showing {filtered.length} of {data?.total || 0} tables
        </p>
      )}
    </div>
  );
}
