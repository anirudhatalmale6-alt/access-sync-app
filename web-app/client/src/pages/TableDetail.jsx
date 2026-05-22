import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import Pagination from '../components/Pagination';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

export default function TableDetail() {
  const { name } = useParams();
  const [data, setData] = useState(null);
  const [schema, setSchema] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [sort, setSort] = useState('');
  const [order, setOrder] = useState('asc');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [showSchema, setShowSchema] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tableData, schemaData] = await Promise.all([
        api.getTableData(name, { page, limit, sort, order, search, filters }),
        schema ? Promise.resolve(schema) : api.getTableSchema(name)
      ]);
      setData(tableData);
      if (!schema) setSchema(schemaData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [name, page, limit, sort, order, search, filters]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleSort(col) {
    if (sort === col) {
      setOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(col);
      setOrder('asc');
    }
    setPage(1);
  }

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function handleFilterChange(col, value) {
    setFilters(prev => {
      const next = { ...prev };
      if (value) {
        next[col] = value;
      } else {
        delete next[col];
      }
      return next;
    });
    setPage(1);
  }

  function clearFilters() {
    setFilters({});
    setSearch('');
    setSearchInput('');
    setSort('');
    setOrder('asc');
    setPage(1);
  }

  const hasFilters = search || Object.keys(filters).length > 0;

  return (
    <div className="space-y-4">
      {/* Breadcrumb & Header */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/tables" className="hover:text-blue-600">Tables</Link>
        <span>/</span>
        <span className="font-medium text-gray-800 font-mono">{name}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 font-mono">{name}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSchema(!showSchema)}
            className="btn-secondary text-sm"
          >
            {showSchema ? 'Hide' : 'Show'} Schema
          </button>
          <button
            onClick={() => api.exportTableCSV(name)}
            className="btn-primary text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Schema panel */}
      {showSchema && schema && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Column Schema</h3>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Nullable</th>
                  <th>Max Length</th>
                </tr>
              </thead>
              <tbody>
                {schema.columns.map(col => (
                  <tr key={col.name}>
                    <td className="text-gray-400">{col.position}</td>
                    <td className="font-mono font-medium">{col.name}</td>
                    <td className="font-mono text-xs">{col.type}</td>
                    <td>{col.nullable ? 'Yes' : 'No'}</td>
                    <td>{col.max_length || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px] max-w-md">
            <div className="relative">
              <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search across all text columns..."
                className="input pl-10"
              />
            </div>
          </form>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary text-sm ${showFilters ? 'bg-blue-100 text-blue-700' : ''}`}
          >
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm text-red-600 hover:text-red-700 font-medium">
              Clear All
            </button>
          )}
          {data && (
            <span className="text-sm text-gray-500 ml-auto">
              {data.pagination.total.toLocaleString()} rows
            </span>
          )}
        </div>

        {/* Column filters */}
        {showFilters && data?.columns && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-medium text-gray-500 mb-2">Filter by column:</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {data.columns.slice(0, 24).map(col => (
                <div key={col}>
                  <label className="text-xs text-gray-500 truncate block">{col}</label>
                  <input
                    type="text"
                    value={filters[col] || ''}
                    onChange={e => handleFilterChange(col, e.target.value)}
                    placeholder={col}
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Data Table */}
      {loading ? (
        <LoadingSpinner message="Loading data..." />
      ) : error ? (
        <ErrorMessage message={error} onRetry={loadData} />
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {data.columns.map(col => (
                      <th key={col} onClick={() => handleSort(col)}>
                        <span className="inline-flex items-center">
                          {col}
                          {sort === col && (
                            <span className="text-blue-600 ml-1">
                              {order === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={data.columns.length} className="text-center py-8 text-gray-500">
                        No data found
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row, i) => (
                      <tr key={i}>
                        {data.columns.map(col => (
                          <td key={col} title={row[col] != null ? String(row[col]) : ''}>
                            {row[col] != null ? String(row[col]) : <span className="text-gray-300 italic">null</span>}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.total_pages}
            total={data.pagination.total}
            limit={data.pagination.limit}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
