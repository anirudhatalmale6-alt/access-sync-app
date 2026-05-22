import React, { useState, useEffect } from 'react';
import { api } from '../api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form state
  const [form, setForm] = useState({
    access_db_path: '',
    pg_host: '',
    pg_port: 5432,
    pg_database: '',
    pg_user: '',
    pg_password: '',
    sync_interval_minutes: 30,
    tables_to_exclude: ''
  });

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSettings();
      setSettings(data);
      setForm({
        access_db_path: data.access_db_path || '',
        pg_host: data.pg_host || '',
        pg_port: data.pg_port || 5432,
        pg_database: data.pg_database || '',
        pg_user: data.pg_user || '',
        pg_password: data.pg_password || '',
        sync_interval_minutes: data.sync_interval_minutes || 30,
        tables_to_exclude: (data.tables_to_exclude || []).join(', ')
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSettings(); }, []);

  function handleChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setSaveMsg(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = {
        ...form,
        pg_port: parseInt(form.pg_port) || 5432,
        sync_interval_minutes: parseInt(form.sync_interval_minutes) || 30,
        tables_to_exclude: form.tables_to_exclude
          ? form.tables_to_exclude.split(',').map(s => s.trim()).filter(Boolean)
          : []
      };
      await api.updateSettings(payload);
      setSaveMsg({ type: 'success', text: 'Settings saved successfully' });
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  function copyApiKey() {
    if (settings?.api_key) {
      navigator.clipboard.writeText(settings.api_key).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  if (loading) return <LoadingSpinner message="Loading settings..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadSettings} />;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* API Key Section */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">API Key</h2>
        <p className="text-sm text-gray-500 mb-4">
          Use this key in the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">X-API-Key</code> header for external API access.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm select-all break-all">
            {settings?.api_key}
          </code>
          <button
            onClick={copyApiKey}
            className="btn-secondary text-sm flex items-center gap-1 whitespace-nowrap"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Access Database */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Access Database</h2>
          <div>
            <label className="label">Database File Path</label>
            <input
              type="text"
              value={form.access_db_path}
              onChange={e => handleChange('access_db_path', e.target.value)}
              placeholder="C:\Data\database.accdb"
              className="input font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">Full path to the Microsoft Access .accdb or .mdb file</p>
          </div>
        </div>

        {/* PostgreSQL Connection */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">PostgreSQL Connection</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Host</label>
              <input
                type="text"
                value={form.pg_host}
                onChange={e => handleChange('pg_host', e.target.value)}
                placeholder="localhost"
                className="input"
              />
            </div>
            <div>
              <label className="label">Port</label>
              <input
                type="number"
                value={form.pg_port}
                onChange={e => handleChange('pg_port', e.target.value)}
                placeholder="5432"
                className="input"
              />
            </div>
            <div>
              <label className="label">Database</label>
              <input
                type="text"
                value={form.pg_database}
                onChange={e => handleChange('pg_database', e.target.value)}
                placeholder="access_sync"
                className="input"
              />
            </div>
            <div>
              <label className="label">User</label>
              <input
                type="text"
                value={form.pg_user}
                onChange={e => handleChange('pg_user', e.target.value)}
                placeholder="postgres"
                className="input"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Password</label>
              <input
                type="password"
                value={form.pg_password}
                onChange={e => handleChange('pg_password', e.target.value)}
                placeholder="Enter password"
                className="input"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="btn-secondary text-sm"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success ? 'Connection successful!' : `Failed: ${testResult.message}`}
              </span>
            )}
          </div>
        </div>

        {/* Sync Settings */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Sync Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Sync Interval (minutes)</label>
              <input
                type="number"
                value={form.sync_interval_minutes}
                onChange={e => handleChange('sync_interval_minutes', e.target.value)}
                min="1"
                max="1440"
                className="input max-w-[200px]"
              />
              <p className="text-xs text-gray-500 mt-1">How often the Python sync engine runs (1-1440 minutes)</p>
            </div>
            <div>
              <label className="label">Excluded Tables</label>
              <input
                type="text"
                value={form.tables_to_exclude}
                onChange={e => handleChange('tables_to_exclude', e.target.value)}
                placeholder="table1, table2, table3"
                className="input"
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated list of table names to skip during sync</p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {saveMsg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
